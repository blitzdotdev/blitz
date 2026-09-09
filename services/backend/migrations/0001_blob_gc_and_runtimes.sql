-- Content-addressed blob reference tracking and the canonical runtime registry.
PRAGMA foreign_keys = ON;

CREATE TABLE blobs (
  sha256 TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  ref_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_referenced_at TEXT
);

CREATE INDEX idx_blobs_sweep
ON blobs(ref_count, created_at);

CREATE TABLE runtimes (
  version TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_runtimes_sha256
ON runtimes(sha256);

-- Count a hash once per release even when multiple manifest paths reuse it.
WITH release_refs AS (
  SELECT DISTINCT
    r.id AS release_id,
    r.created_at AS release_created_at,
    json_extract(file.value, '$.sha256') AS sha256,
    CAST(json_extract(file.value, '$.size') AS INTEGER) AS size
  FROM releases AS r, json_each(r.manifest_json, '$.files') AS file
  WHERE json_extract(file.value, '$.sha256') IS NOT NULL
)
INSERT INTO blobs (sha256, size, ref_count, created_at, last_referenced_at)
SELECT
  sha256,
  MAX(size),
  COUNT(*),
  MIN(release_created_at),
  MAX(release_created_at)
FROM release_refs
GROUP BY sha256;
