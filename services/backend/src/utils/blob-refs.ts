import type { ManifestFile } from "../types.js";

interface InsertedRelease {
  id: string;
  gameId: string;
  releaseHash: string;
}

export function incrementBlobRefStatements(
  db: D1Database,
  files: Record<string, ManifestFile>,
  insertedRelease?: InsertedRelease,
): D1PreparedStatement[] {
  const releaseGuard = insertedRelease
    ? "EXISTS (SELECT 1 FROM releases WHERE id = ? AND game_id = ? AND release_hash = ?)"
    : "true";
  const bindings: Array<string> = [JSON.stringify({ files })];
  if (insertedRelease) {
    bindings.push(insertedRelease.id, insertedRelease.gameId, insertedRelease.releaseHash);
  }
  return [db.prepare(
    `INSERT INTO blobs (sha256, size, ref_count, created_at, last_referenced_at)
     SELECT
       json_extract(file.value, '$.sha256'),
       MAX(CAST(json_extract(file.value, '$.size') AS INTEGER)),
       1,
       datetime('now'),
       datetime('now')
     FROM json_each(?, '$.files') AS file
     WHERE ${releaseGuard}
     GROUP BY json_extract(file.value, '$.sha256')
     ON CONFLICT(sha256) DO UPDATE SET
       size = excluded.size,
       ref_count = blobs.ref_count + 1,
       last_referenced_at = datetime('now')`,
  ).bind(...bindings)];
}

export function decrementGameBlobRefsStatement(db: D1Database, gameId: string): D1PreparedStatement {
  return db.prepare(
    `UPDATE blobs
     SET ref_count = MAX(0, ref_count - (
       SELECT COUNT(*)
       FROM releases AS release
       WHERE release.game_id = ?
         AND EXISTS (
           SELECT 1
           FROM json_each(release.manifest_json, '$.files') AS file
           WHERE json_extract(file.value, '$.sha256') = blobs.sha256
         )
     ))
     WHERE EXISTS (
       SELECT 1
       FROM releases AS release
       WHERE release.game_id = ?
         AND EXISTS (
           SELECT 1
           FROM json_each(release.manifest_json, '$.files') AS file
           WHERE json_extract(file.value, '$.sha256') = blobs.sha256
         )
     )`,
  ).bind(gameId, gameId);
}
