import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, GameRow } from "../types.js";
import { platformAuthMiddleware } from "../middleware/agent-auth.js";
import { AGENT_TOKEN_PREFIX } from "../utils/anon-constants.js";
import { randomBase64Url, sha256Hex } from "../utils/crypto.js";
import { jsonError, readJsonObject } from "../utils/http.js";

export const tokens = new Hono<AppEnv>();

async function ownedGame(c: Context<AppEnv>): Promise<GameRow | null> {
  const idOrSlug = c.req.param("id");
  return c.env.DB.prepare(
    "SELECT * FROM games WHERE (id = ? OR slug = ?) AND owner_id = ? LIMIT 1",
  ).bind(idOrSlug, idOrSlug, c.get("userId")).first<GameRow>();
}

function gameStateError(game: GameRow): Response | null {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  if (game.state === "cleaning" || (game.expires_at && game.expires_at <= now)) {
    return jsonError(410, "game_expired", "The game has expired.");
  }
  if (game.state !== "open") return jsonError(409, "game_not_open", "The game is not open.");
  return null;
}

tokens.post("/api/v1/games/:id/tokens", platformAuthMiddleware, async (c) => {
  const game = await ownedGame(c);
  if (!game) return jsonError(404, "game_not_found", "The game was not found or is not owned by this user.");
  const stateError = gameStateError(game);
  if (stateError) return stateError;
  const body = await readJsonObject(c.req.raw);
  const name = body && typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError(400, "invalid_token_name", "A token name is required.");
  if (name.length > 80) return jsonError(400, "invalid_token_name", "Token name must be at most 80 characters.");

  const rawToken = `${AGENT_TOKEN_PREFIX}${randomBase64Url(32)}`;
  const token = {
    id: crypto.randomUUID(),
    name,
    token_prefix: rawToken.slice(0, 8),
    raw_token: rawToken,
  };
  await c.env.DB.prepare(
    "INSERT INTO game_tokens (id, game_id, name, token_hash, token_prefix) VALUES (?, ?, ?, ?, ?)",
  ).bind(token.id, game.id, token.name, await sha256Hex(rawToken), token.token_prefix).run();
  return c.json({ token }, 201);
});

tokens.get("/api/v1/games/:id/tokens", platformAuthMiddleware, async (c) => {
  const game = await ownedGame(c);
  if (!game) return jsonError(404, "game_not_found", "The game was not found or is not owned by this user.");
  const result = await c.env.DB.prepare(
    `SELECT id, name, token_prefix, last_used_at, revoked, created_at
     FROM game_tokens WHERE game_id = ? ORDER BY created_at DESC, id DESC`,
  ).bind(game.id).all<{
    id: string;
    name: string;
    token_prefix: string;
    last_used_at: string | null;
    revoked: number;
    created_at: string;
  }>();
  return c.json({ tokens: result.results });
});

tokens.delete("/api/v1/games/:id/tokens/:tokenId", platformAuthMiddleware, async (c) => {
  const game = await ownedGame(c);
  if (!game) return jsonError(404, "game_not_found", "The game was not found or is not owned by this user.");
  const stateError = gameStateError(game);
  if (stateError) return stateError;
  const tokenId = c.req.param("tokenId");
  const revoked = await c.env.DB.prepare(
    "UPDATE game_tokens SET revoked = 1 WHERE id = ? AND game_id = ? RETURNING id",
  ).bind(tokenId, game.id).first<{ id: string }>();
  if (!revoked) return jsonError(404, "token_not_found", "The token was not found for this game.");
  return c.json({ token: { id: revoked.id, revoked: true } });
});
