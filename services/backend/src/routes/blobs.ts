import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { gameAuthMiddleware } from "../middleware/agent-auth.js";
import { jsonError, positiveInteger, readJsonObject } from "../utils/http.js";
import { SHA256_RE } from "../utils/validation.js";

export const blobs = new Hono<AppEnv>();
const DEFAULT_MAX_BLOB_BYTES = 100 * 1024 * 1024;

blobs.post("/api/v1/games/:id/blobs/missing", gameAuthMiddleware, async (c) => {
  const body = await readJsonObject(c.req.raw);
  if (!body || !Array.isArray(body.hashes)) return jsonError(400, "bad_request", "Body must be { hashes: string[] }.");
  if (body.hashes.length > 2_000) return jsonError(413, "too_many_hashes", "At most 2000 hashes may be checked.");
  const hashes = [...new Set(body.hashes)];
  if (!hashes.every((hash): hash is string => typeof hash === "string" && SHA256_RE.test(hash))) {
    return jsonError(400, "invalid_hash", "Every hash must be lowercase SHA-256 hex.");
  }

  const missing: string[] = [];
  for (let offset = 0; offset < hashes.length; offset += 32) {
    const chunk = hashes.slice(offset, offset + 32);
    const heads = await Promise.all(chunk.map((hash) => c.env.BLOBS.head(`blobs/${hash}`)));
    heads.forEach((head, index) => { if (!head) missing.push(chunk[index]); });
  }
  return c.json({ missing });
});

// Hono dispatches HEAD through GET handlers and strips the body.
blobs.get("/api/v1/games/:id/blobs/:sha256", gameAuthMiddleware, async (c) => {
  const hash = c.req.param("sha256");
  if (!SHA256_RE.test(hash)) return jsonError(400, "invalid_hash", "sha256 must be lowercase hexadecimal.");
  const object = await c.env.BLOBS.head(`blobs/${hash}`);
  if (!object) return new Response(null, { status: 404 });
  return new Response(null, {
    headers: {
      "Content-Length": String(object.size),
      "ETag": `"${hash}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});

blobs.put("/api/v1/games/:id/blobs/:sha256", gameAuthMiddleware, async (c) => {
  const hash = c.req.param("sha256");
  if (!SHA256_RE.test(hash)) return jsonError(400, "invalid_hash", "sha256 must be lowercase hexadecimal.");
  const finalKey = `blobs/${hash}`;
  const existing = await c.env.BLOBS.head(finalKey);
  if (existing) return c.json({ sha256: hash, size: existing.size, uploaded: false });

  const maxBytes = positiveInteger(c.env.MAX_BLOB_BYTES, DEFAULT_MAX_BLOB_BYTES);
  const lengthHeader = c.req.header("content-length");
  const declaredLength = lengthHeader ? Number(lengthHeader) : null;
  if (declaredLength === null) {
    return jsonError(411, "content_length_required", "Content-Length is required for streamed blob uploads.");
  }
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
    return jsonError(400, "invalid_content_length", "Content-Length is invalid.");
  }
  if (declaredLength > maxBytes) {
    return jsonError(413, "blob_too_large", `Blob exceeds the ${maxBytes}-byte limit.`);
  }
  if (!c.req.raw.body) return jsonError(400, "body_required", "A binary request body is required.");

  try {
    // R2 computes SHA-256 while consuming the fixed-length request stream and
    // atomically rejects a checksum mismatch, so no partial final object exists.
    await c.env.BLOBS.put(finalKey, c.req.raw.body, { sha256: hash });
    return c.json({ sha256: hash, size: declaredLength, uploaded: true }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/sha-?256|checksum|hash/i.test(message)) {
      return jsonError(422, "hash_mismatch", "The uploaded bytes do not match the URL SHA-256.", { expected: hash });
    }
    throw error;
  }
});
