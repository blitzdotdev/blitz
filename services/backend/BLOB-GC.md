# Blob garbage collection

Objects under `blobs/<sha256>` are global, content-addressed, and shared across games. D1 is the ownership index:

- `blobs` records object size, creation time, release `ref_count`, and the last time a release referenced the hash.
- `runtimes` maps a runtime version to its canonical blob. Runtime rows are GC roots independent of `ref_count`.
- The `0001_blob_gc_and_runtimes.sql` migration backfills one reference per distinct SHA-256 per existing release.

## Reference updates

Every successful blob upload upserts its `blobs` row without changing an existing count. A new release increments each distinct manifest SHA-256 once. Forking an active release does the same for the fork's copied release row.

Publish uses one atomic D1 batch to insert the release, update the game's active release, increment blob references, prune retention, decrement pruned-release references, and delete pruned rows. `RELEASE_RETENTION` defaults to `10`; the active release is never a pruning candidate.

Explicit game deletion and expiry cleanup decrement every distinct SHA-256 once per deleted release in the same D1 batch that deletes the game. Foreign-key cascades then remove releases and deploy tokens.

## Sweep

The `*/10 * * * *` cron considers at most 500 rows per run. A row is eligible only when:

- `ref_count = 0`;
- `created_at` is at least `BLOB_GRACE_SECONDS` old (default `86400`, or 24 hours); and
- no runtime row uses the SHA-256.

Candidates are rechecked against D1 immediately before R2 deletion. R2 keys are deleted in arrays of at most 1,000, then each D1 row is deleted conditionally with the same zero-reference, age, and runtime-root guards. Every run emits one structured `blob_sweep` summary.

## Reconciliation

The `0 0 * * *` cron lists at most `RECONCILE_BATCH` R2 objects (default `500`, capped at R2's 1,000-object limit). Its R2 cursor is stored in the existing `ANON_TRIPWIRE` KV namespace at `blob-gc:reconcile-cursor`, so large buckets continue on the next daily run.

For each valid `blobs/<sha256>` object, reconciliation:

1. Creates a missing `blobs` row with `ref_count = 0`, the R2 object size, and the object's upload time, preserving the grace window.
2. Recomputes release references from all stored manifests, counting a hash once per release, and corrects mismatched counts.
3. Preserves runtime roots through the separate `runtimes` table check used by sweep.

Every run emits one structured `blob_reconcile` summary with listed, discovered, corrected, and cursor state counts.

For local testing, run Wrangler with `--test-scheduled` and call `/cdn-cgi/local/scheduled?cron=...`. Do not set `BLOB_GRACE_SECONDS=0` against production; the deployed default remains 86,400 seconds.
