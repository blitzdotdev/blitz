import type { AppEnv } from "../types.js";
import { nonNegativeInteger, positiveInteger } from "../utils/http.js";
import { SHA256_RE } from "../utils/validation.js";

const DEFAULT_BLOB_GRACE_SECONDS = 86_400;
const DEFAULT_RECONCILE_BATCH = 500;
const SWEEP_BATCH = 500;
const R2_DELETE_CHUNK = 1_000;
const RECONCILE_CURSOR_KEY = "blob-gc:reconcile-cursor";

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

export async function runBlobSweep(env: AppEnv["Bindings"]): Promise<number> {
  const graceSeconds = nonNegativeInteger(env.BLOB_GRACE_SECONDS, DEFAULT_BLOB_GRACE_SECONDS);
  const age = `-${graceSeconds} seconds`;
  const candidates = await env.DB.prepare(
    `SELECT blob.sha256
     FROM blobs AS blob
     WHERE blob.ref_count = 0
       AND blob.created_at <= datetime('now', ?)
       AND NOT EXISTS (SELECT 1 FROM runtimes WHERE runtimes.sha256 = blob.sha256)
     ORDER BY blob.created_at ASC, blob.sha256 ASC
     LIMIT ?`,
  ).bind(age, SWEEP_BATCH).all<{ sha256: string }>();

  const hashesJson = JSON.stringify(candidates.results.map((row) => row.sha256));
  const rechecked = candidates.results.length === 0
    ? { results: [] as Array<{ sha256: string }> }
    : await env.DB.prepare(
      `SELECT sha256 FROM blobs
       WHERE sha256 IN (SELECT value FROM json_each(?))
         AND ref_count = 0
         AND created_at <= datetime('now', ?)
         AND NOT EXISTS (SELECT 1 FROM runtimes WHERE runtimes.sha256 = blobs.sha256)`,
    ).bind(hashesJson, age).all<{ sha256: string }>();
  const approved = rechecked.results.map((row) => row.sha256);

  for (const chunk of chunks(approved, R2_DELETE_CHUNK)) {
    await env.BLOBS.delete(chunk.map((hash) => `blobs/${hash}`));
  }

  const deleted = approved.length === 0
    ? null
    : await env.DB.prepare(
      `DELETE FROM blobs
       WHERE sha256 IN (SELECT value FROM json_each(?))
         AND ref_count = 0
         AND created_at <= datetime('now', ?)
         AND NOT EXISTS (SELECT 1 FROM runtimes WHERE runtimes.sha256 = blobs.sha256)`,
    ).bind(JSON.stringify(approved), age).run();
  const deletedRows = deleted?.meta.changes ?? 0;

  console.log(JSON.stringify({
    event: "blob_sweep",
    candidates: candidates.results.length,
    approved: approved.length,
    deleted_rows: deletedRows,
    grace_seconds: graceSeconds,
  }));
  return deletedRows;
}

interface ReconcileRefRow {
  sha256: string;
  ref_count: number;
  expected_ref_count: number;
}

export async function runBlobReconciliation(env: AppEnv["Bindings"]): Promise<void> {
  const requestedLimit = positiveInteger(env.RECONCILE_BATCH, DEFAULT_RECONCILE_BATCH);
  const limit = Math.min(requestedLimit, 1_000);
  const cursor = await env.ANON_TRIPWIRE.get(RECONCILE_CURSOR_KEY);
  const listed = await env.BLOBS.list({
    prefix: "blobs/",
    limit,
    ...(cursor ? { cursor } : {}),
  });
  const objects = listed.objects.flatMap((object) => {
    const hash = object.key.slice("blobs/".length);
    return SHA256_RE.test(hash) ? [{ hash, object }] : [];
  });

  const existing = new Set<string>();
  if (objects.length > 0) {
    const result = await env.DB.prepare(
      "SELECT sha256 FROM blobs WHERE sha256 IN (SELECT value FROM json_each(?))",
    ).bind(JSON.stringify(objects.map(({ hash }) => hash))).all<{ sha256: string }>();
    result.results.forEach((row) => existing.add(row.sha256));
  }

  if (objects.length > 0) {
    await env.DB.prepare(
      `INSERT INTO blobs (sha256, size, ref_count, created_at, last_referenced_at)
       SELECT
         json_extract(entry.value, '$.hash'),
         CAST(json_extract(entry.value, '$.size') AS INTEGER),
         0,
         json_extract(entry.value, '$.createdAt'),
         NULL
       FROM json_each(?) AS entry
       WHERE true
       ON CONFLICT(sha256) DO UPDATE SET size = excluded.size`,
    ).bind(JSON.stringify(objects.map(({ hash, object }) => ({
      hash,
      size: object.size,
      createdAt: object.uploaded.toISOString().slice(0, 19).replace("T", " "),
    })))).run();
  }

  const mismatches: ReconcileRefRow[] = [];
  if (objects.length > 0) {
    const result = await env.DB.prepare(
      `SELECT
         blob.sha256,
         blob.ref_count,
         (
           SELECT COUNT(*)
           FROM releases AS release
           WHERE EXISTS (
             SELECT 1
             FROM json_each(release.manifest_json, '$.files') AS file
             WHERE json_extract(file.value, '$.sha256') = blob.sha256
           )
         ) AS expected_ref_count
       FROM blobs AS blob
       WHERE blob.sha256 IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(objects.map(({ hash }) => hash))).all<ReconcileRefRow>();
    mismatches.push(...result.results.filter((row) => row.ref_count !== row.expected_ref_count));
  }

  if (mismatches.length > 0) {
    await env.DB.prepare(
      `WITH expected AS (
         SELECT
           json_extract(entry.value, '$.sha256') AS sha256,
           CAST(json_extract(entry.value, '$.refCount') AS INTEGER) AS ref_count
         FROM json_each(?) AS entry
       )
       UPDATE blobs
       SET
         ref_count = (SELECT expected.ref_count FROM expected WHERE expected.sha256 = blobs.sha256),
         last_referenced_at = CASE
           WHEN (SELECT expected.ref_count FROM expected WHERE expected.sha256 = blobs.sha256) > 0
             THEN datetime('now')
           ELSE last_referenced_at
         END
       WHERE sha256 IN (SELECT sha256 FROM expected)`,
    ).bind(JSON.stringify(mismatches.map((row) => ({
      sha256: row.sha256,
      refCount: row.expected_ref_count,
    })))).run();
  }

  if (listed.truncated && listed.cursor) {
    await env.ANON_TRIPWIRE.put(RECONCILE_CURSOR_KEY, listed.cursor);
  } else {
    await env.ANON_TRIPWIRE.delete(RECONCILE_CURSOR_KEY);
  }

  console.log(JSON.stringify({
    event: "blob_reconcile",
    listed: listed.objects.length,
    valid_objects: objects.length,
    discovered: objects.length - existing.size,
    corrected: mismatches.length,
    truncated: listed.truncated,
    cursor_reset: !listed.truncated,
  }));
}
