import { Hono } from "hono";
import type { AppEnv, GameRow } from "../types.js";
import { gameAuthMiddleware, platformAuthMiddleware } from "../middleware/agent-auth.js";
import { ANON_SENTINEL_USER_ID } from "../utils/anon-constants.js";
import { randomBase64Url, sha256Hex, timingSafeHexEqual } from "../utils/crypto.js";
import { jsonError, readJsonObject } from "../utils/http.js";

export const claims = new Hono<AppEnv>();

claims.post("/api/v1/games/:id/authorize-claim-secret", gameAuthMiddleware, async (c) => {
  const gameId = c.get("gameId");
  const secret = randomBase64Url(32);
  const hash = await sha256Hex(secret);
  const result = await c.env.DB.prepare(
    `UPDATE games SET claim_secret_hash = ?, updated_at = datetime('now')
     WHERE id = ? AND owner_id = ? AND expires_at > datetime('now')
       AND claim_secret_hash IS NULL
     RETURNING slug`,
  ).bind(hash, gameId, ANON_SENTINEL_USER_ID).first<{ slug: string }>();
  if (!result) {
    const game = await c.env.DB.prepare("SELECT owner_id, expires_at, claim_secret_hash FROM games WHERE id = ?")
      .bind(gameId).first<Pick<GameRow, "owner_id" | "expires_at" | "claim_secret_hash">>();
    if (!game) return jsonError(404, "game_not_found", "The game was not found.");
    if (game.owner_id !== ANON_SENTINEL_USER_ID || !game.expires_at) return jsonError(409, "not_anonymous", "Only anonymous games can bind a claim secret.");
    if (game.claim_secret_hash) return jsonError(409, "already_authorized", "A claim secret was already issued for this game.");
    return jsonError(410, "game_expired", "The game has expired.");
  }
  return c.json({ game_id: gameId, slug: result.slug, claim_secret: secret }, 201);
});

claims.post("/api/v1/games/:slug/claim", platformAuthMiddleware, async (c) => {
  const body = await readJsonObject(c.req.raw);
  const secret = body && typeof body.secret === "string" ? body.secret : "";
  if (!secret) return jsonError(400, "claim_secret_required", "Body must include secret.");
  const slug = c.req.param("slug");
  const game = await c.env.DB.prepare("SELECT * FROM games WHERE slug = ? LIMIT 1")
    .bind(slug).first<GameRow>();
  if (!game) return jsonError(404, "game_not_found", "The game was not found.");
  if (game.owner_id !== ANON_SENTINEL_USER_ID) return jsonError(409, "already_claimed", "The game is already owned.");
  if (game.state !== "open" || !game.expires_at || game.expires_at <= new Date().toISOString().slice(0, 19).replace("T", " ")) {
    return jsonError(410, "game_expired", "The game has expired.");
  }
  if (!game.claim_secret_hash) return jsonError(409, "claim_not_authorized", "The game has no claim secret.");
  const incomingHash = await sha256Hex(secret);
  if (!timingSafeHexEqual(incomingHash, game.claim_secret_hash)) return jsonError(403, "invalid_claim_secret", "The claim secret is invalid.");

  const claimed = await c.env.DB.prepare(
    `UPDATE games
     SET owner_id = ?, expires_at = NULL, anon_meta = NULL, claim_secret_hash = NULL,
         listed = 1, updated_at = datetime('now')
     WHERE id = ? AND owner_id = ? AND state = 'open' AND expires_at > datetime('now')
       AND claim_secret_hash = ?
     RETURNING id, slug, owner_id`,
  ).bind(c.get("userId"), game.id, ANON_SENTINEL_USER_ID, game.claim_secret_hash)
    .first<{ id: string; slug: string; owner_id: string }>();
  if (!claimed) return jsonError(409, "claim_conflict", "The game changed while it was being claimed.");
  return c.json({ game_id: claimed.id, slug: claimed.slug, owner_id: claimed.owner_id, claimed: true });
});
