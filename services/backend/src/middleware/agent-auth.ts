import type { MiddlewareHandler } from "hono";
import type { AppEnv, GameRow } from "../types.js";
import { AGENT_TOKEN_PREFIX } from "../utils/anon-constants.js";
import { sha256Hex } from "../utils/crypto.js";
import { jsonError } from "../utils/http.js";

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export const platformAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearerToken(c.req.header("authorization"));
  if (!token || token.startsWith(AGENT_TOKEN_PREFIX)) {
    return jsonError(401, "authentication_required", "A platform Bearer token is required.");
  }

  const db = c.get("$db");
  try {
    await db.initAuth(token);
  } catch {
    return jsonError(401, "invalid_token", "The platform token is invalid or expired.");
  }
  if (!db.auth.uid) return jsonError(401, "invalid_token", "The platform token is invalid or expired.");

  c.set("userId", db.auth.uid);
  c.set("username", typeof db.auth.jwt.user === "string" ? db.auth.jwt.user : "user");
  c.set("authKind", "platform");
  await next();
};

export const gameAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearerToken(c.req.header("authorization"));
  if (!token) return jsonError(401, "authentication_required", "A Bearer token is required.");
  const idOrSlug = c.req.param("id");
  if (!idOrSlug) return jsonError(400, "bad_request", "A game identifier is required.");

  if (token.startsWith(AGENT_TOKEN_PREFIX)) {
    const tokenHash = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      `SELECT gt.id AS token_id, g.*
       FROM game_tokens gt
       JOIN games g ON g.id = gt.game_id
       WHERE gt.token_hash = ? AND gt.revoked = 0
         AND (g.id = ? OR g.slug = ?)
       ORDER BY CASE WHEN g.slug = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    ).bind(tokenHash, idOrSlug, idOrSlug, idOrSlug).first<(GameRow & { token_id: string })>();
    if (!row) return jsonError(401, "invalid_token", "The game token is invalid, revoked, or scoped to another game.");

    c.executionCtx.waitUntil(
      c.env.DB.prepare("UPDATE game_tokens SET last_used_at = datetime('now') WHERE id = ?")
        .bind(row.token_id).run().then(() => undefined).catch(() => undefined),
    );
    c.set("userId", row.owner_id);
    c.set("username", "agent");
    c.set("authKind", "agent");
    c.set("agentTokenId", row.token_id);
    c.set("gameId", row.id);
    c.set("gameSlug", row.slug);
  } else {
    const db = c.get("$db");
    try {
      await db.initAuth(token);
    } catch {
      return jsonError(401, "invalid_token", "The platform token is invalid or expired.");
    }
    if (!db.auth.uid) return jsonError(401, "invalid_token", "The platform token is invalid or expired.");
    const row = await c.env.DB.prepare(
      `SELECT * FROM games
       WHERE (id = ? OR slug = ?) AND owner_id = ?
       ORDER BY CASE WHEN slug = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    ).bind(idOrSlug, idOrSlug, db.auth.uid, idOrSlug).first<GameRow>();
    if (!row) return jsonError(404, "game_not_found", "The game was not found or is not owned by this user.");

    c.set("userId", db.auth.uid);
    c.set("username", typeof db.auth.jwt.user === "string" ? db.auth.jwt.user : "user");
    c.set("authKind", "platform");
    c.set("gameId", row.id);
    c.set("gameSlug", row.slug);
  }

  const game = await c.env.DB.prepare(
    "SELECT state, expires_at FROM games WHERE id = ?",
  ).bind(c.get("gameId")).first<{ state: string; expires_at: string | null }>();
  if (!game) return jsonError(404, "game_not_found", "The game was not found.");
  if (game.state === "cleaning" || (game.expires_at && game.expires_at <= new Date().toISOString().slice(0, 19).replace("T", " "))) {
    return jsonError(410, "game_expired", "The anonymous game has expired.");
  }
  if (game.state !== "open") return jsonError(409, "game_not_open", "The game is not open.");

  await next();
};
