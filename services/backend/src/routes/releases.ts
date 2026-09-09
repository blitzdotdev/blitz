import { Hono } from "hono";
import type { AppEnv, ManifestFile, ReleaseManifest } from "../types.js";
import { gameAuthMiddleware } from "../middleware/agent-auth.js";
import { sha256Hex } from "../utils/crypto.js";
import { jsonError, positiveInteger, readJsonObject } from "../utils/http.js";
import {
  canonicalizeManifest,
  ManifestValidationError,
  manifestBytes,
  parseManifestFiles,
} from "../utils/manifest.js";
import { previewUrl } from "../utils/preview.js";

export const releases = new Hono<AppEnv>();
const DEFAULT_MAX_GAME_BYTES = 500 * 1024 * 1024;

async function verifyBlobs(bucket: R2Bucket, files: Record<string, ManifestFile>): Promise<{
  missing: string[];
  sizeMismatch: Array<{ path: string; expected: number; actual: number }>;
}> {
  const entries = Object.entries(files);
  const missing: string[] = [];
  const sizeMismatch: Array<{ path: string; expected: number; actual: number }> = [];
  for (let offset = 0; offset < entries.length; offset += 32) {
    const chunk = entries.slice(offset, offset + 32);
    const heads = await Promise.all(chunk.map(([, file]) => bucket.head(`blobs/${file.sha256}`)));
    heads.forEach((head, index) => {
      const [path, file] = chunk[index];
      if (!head) missing.push(file.sha256);
      else if (head.size !== file.size) sizeMismatch.push({ path, expected: file.size, actual: head.size });
    });
  }
  return { missing: [...new Set(missing)], sizeMismatch };
}

releases.put("/api/v1/games/:id/releases", gameAuthMiddleware, async (c) => {
  const body = await readJsonObject(c.req.raw);
  if (!body) return jsonError(400, "bad_request", "A JSON body is required.");

  let files: Record<string, ManifestFile>;
  try {
    files = parseManifestFiles(body.files);
  } catch (error) {
    if (error instanceof ManifestValidationError) return jsonError(400, "invalid_manifest", error.message);
    throw error;
  }
  const message = body.message === undefined ? null : String(body.message).trim();
  if (message && message.length > 500) return jsonError(400, "invalid_message", "message must be at most 500 characters.");
  const bytesUsed = manifestBytes(files);
  const maxGameBytes = positiveInteger(c.env.MAX_GAME_BYTES, DEFAULT_MAX_GAME_BYTES);
  if (bytesUsed > maxGameBytes) {
    return jsonError(413, "game_quota_exceeded", `Manifest exceeds the ${maxGameBytes}-byte game quota.`, { bytes_used: bytesUsed });
  }

  const verified = await verifyBlobs(c.env.BLOBS, files);
  if (verified.missing.length) return jsonError(409, "missing_blobs", "One or more manifest blobs are missing.", { missing: verified.missing });
  if (verified.sizeMismatch.length) return jsonError(409, "blob_size_mismatch", "One or more manifest sizes do not match R2.", { mismatches: verified.sizeMismatch });

  const manifestJson = canonicalizeManifest(files);
  const releaseHash = await sha256Hex(manifestJson);
  const gameId = c.get("gameId");
  const existing = await c.env.DB.prepare(
    "SELECT id FROM releases WHERE game_id = ? AND release_hash = ?",
  ).bind(gameId, releaseHash).first<{ id: string }>();

  const statements = [];
  if (!existing) {
    statements.push(c.env.DB.prepare(
      "INSERT INTO releases (id, release_hash, game_id, manifest_json, message) VALUES (?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), releaseHash, gameId, manifestJson, message || null));
  }
  statements.push(c.env.DB.prepare(
    "UPDATE games SET active_release = ?, bytes_used = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(releaseHash, bytesUsed, gameId));
  await c.env.DB.batch(statements);

  return c.json({
    release_hash: releaseHash,
    preview_url: previewUrl(c.env, c.get("gameSlug")),
    files,
  }, existing ? 200 : 201);
});

releases.get("/api/v1/games/:id/releases", gameAuthMiddleware, async (c) => {
  const [result, game] = await Promise.all([
    c.env.DB.prepare(
      `SELECT release_hash, manifest_json, created_at, message
       FROM releases WHERE game_id = ? ORDER BY created_at DESC, id DESC`,
    ).bind(c.get("gameId")).all<{ release_hash: string; manifest_json: string; created_at: string; message: string | null }>(),
    c.env.DB.prepare("SELECT active_release FROM games WHERE id = ?")
      .bind(c.get("gameId")).first<{ active_release: string | null }>(),
  ]);
  return c.json({ releases: result.results.map((release) => {
    const manifest = JSON.parse(release.manifest_json) as ReleaseManifest;
    return {
      release_hash: release.release_hash,
      created_at: release.created_at,
      message: release.message,
      files: Object.keys(manifest.files).length,
      active: release.release_hash === game?.active_release,
    };
  }) });
});

releases.post("/api/v1/games/:id/releases/:hash/activate", gameAuthMiddleware, async (c) => {
  const hash = c.req.param("hash");
  const release = await c.env.DB.prepare(
    "SELECT manifest_json FROM releases WHERE game_id = ? AND release_hash = ?",
  ).bind(c.get("gameId"), hash).first<{ manifest_json: string }>();
  if (!release) return jsonError(404, "release_not_found", "The release was not found for this game.");
  const manifest = JSON.parse(release.manifest_json) as ReleaseManifest;
  const bytesUsed = manifestBytes(manifest.files);
  await c.env.DB.prepare(
    "UPDATE games SET active_release = ?, bytes_used = ?, updated_at = datetime('now') WHERE id = ?",
  ).bind(hash, bytesUsed, c.get("gameId")).run();
  return c.json({ release_hash: hash, preview_url: previewUrl(c.env, c.get("gameSlug")), files: Object.keys(manifest.files).length });
});
