import { Hono } from "hono";
import type { AppEnv, RuntimeRow } from "../types.js";
import { sha256Hex, timingSafeStringEqual } from "../utils/crypto.js";
import { jsonError, positiveInteger } from "../utils/http.js";

export const runtimes = new Hono<AppEnv>();

const DEFAULT_MAX_RUNTIME_BYTES = 100 * 1024 * 1024;
const RUNTIME_VERSION_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;

function validVersion(version: string): boolean {
  return version.length <= 128 && RUNTIME_VERSION_RE.test(version);
}

async function hasRuntimeAuth(provided: string | undefined, expected: string | undefined): Promise<boolean> {
  const token = provided?.replace(/^Bearer /, "") ?? "";
  return Boolean(expected && token && await timingSafeStringEqual(token, expected));
}

runtimes.put("/api/v1/runtimes/:version", async (c) => {
  if (!await hasRuntimeAuth(c.req.header("authorization"), c.env.RUNTIME_UPLOAD_TOKEN)) {
    return jsonError(401, "invalid_runtime_token", "A valid runtime upload Bearer token is required.");
  }

  const version = c.req.param("version");
  if (!validVersion(version)) {
    return jsonError(400, "invalid_runtime_version", "Runtime version must be 1-128 letters, digits, dots, underscores, or hyphens.");
  }

  const lengthHeader = c.req.header("content-length");
  const declaredLength = lengthHeader ? Number(lengthHeader) : null;
  if (declaredLength === null) {
    return jsonError(411, "content_length_required", "Content-Length is required for runtime uploads.");
  }
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
    return jsonError(400, "invalid_content_length", "Content-Length is invalid.");
  }
  const maxBytes = positiveInteger(c.env.MAX_BLOB_BYTES, DEFAULT_MAX_RUNTIME_BYTES);
  if (declaredLength > maxBytes) {
    return jsonError(413, "runtime_too_large", `Runtime exceeds the ${maxBytes}-byte limit.`);
  }
  if (!c.req.raw.body) return jsonError(400, "body_required", "A binary request body is required.");

  const bytes = await c.req.raw.arrayBuffer();
  if (bytes.byteLength !== declaredLength) {
    return jsonError(400, "content_length_mismatch", "Content-Length does not match the runtime body.");
  }
  const hash = await sha256Hex(bytes);
  const key = `blobs/${hash}`;
  const existing = await c.env.BLOBS.head(key);
  if (!existing) {
    try {
      await c.env.BLOBS.put(key, bytes, { sha256: hash });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/sha-?256|checksum|hash/i.test(message)) {
        return jsonError(422, "hash_mismatch", "The runtime bytes failed R2 checksum verification.");
      }
      throw error;
    }
  } else if (existing.size !== declaredLength) {
    return jsonError(409, "runtime_blob_conflict", "The content-addressed runtime object has an unexpected size.");
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO blobs (sha256, size, ref_count, created_at, last_referenced_at)
       VALUES (?, ?, 0, datetime('now'), NULL)
       ON CONFLICT(sha256) DO UPDATE SET size = excluded.size`,
    ).bind(hash, declaredLength),
    c.env.DB.prepare(
      `INSERT INTO runtimes (version, sha256, size, created_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(version) DO UPDATE SET
         sha256 = excluded.sha256,
         size = excluded.size,
         created_at = excluded.created_at`,
    ).bind(version, hash, declaredLength),
  ]);

  return c.json({ version, sha256: hash, size: declaredLength }, 201);
});

runtimes.get("/api/v1/runtimes/:version", async (c) => {
  const version = c.req.param("version");
  if (!validVersion(version)) {
    return jsonError(400, "invalid_runtime_version", "The runtime version is invalid.");
  }
  const row = await c.env.DB.prepare(
    "SELECT version, sha256, size FROM runtimes WHERE version = ? LIMIT 1",
  ).bind(version).first<Pick<RuntimeRow, "version" | "sha256" | "size">>();
  if (!row) return jsonError(404, "runtime_not_found", "The runtime version was not found.");
  return c.json(row);
});

runtimes.get("/api/v1/runtimes", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT version, sha256, size FROM runtimes ORDER BY version ASC",
  ).all<Pick<RuntimeRow, "version" | "sha256" | "size">>();
  return c.json({ runtimes: result.results });
});

runtimes.delete("/api/v1/runtimes/:version", async (c) => {
  if (!await hasRuntimeAuth(c.req.header("authorization"), c.env.RUNTIME_UPLOAD_TOKEN)) {
    return jsonError(401, "invalid_runtime_token", "A valid runtime upload Bearer token is required.");
  }
  const version = c.req.param("version");
  if (!validVersion(version)) {
    return jsonError(400, "invalid_runtime_version", "The runtime version is invalid.");
  }
  const row = await c.env.DB.prepare(
    "DELETE FROM runtimes WHERE version = ? RETURNING version, sha256",
  ).bind(version).first<Pick<RuntimeRow, "version" | "sha256">>();
  if (!row) return jsonError(404, "runtime_not_found", "The runtime version was not found.");
  return c.json({ deleted: true, version: row.version, sha256: row.sha256 });
});
