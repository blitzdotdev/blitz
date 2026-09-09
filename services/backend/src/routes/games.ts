import { Hono } from "hono";
import type { AppEnv, GameRow } from "../types.js";
import { gameAuthMiddleware } from "../middleware/agent-auth.js";
import { jsonError } from "../utils/http.js";
import { previewUrl } from "../utils/preview.js";

export const games = new Hono<AppEnv>();

games.get("/api/v1/games/:id", gameAuthMiddleware, async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT id, owner_id, slug, name, state, visibility, expires_at,
            active_release, bytes_used, created_at, updated_at
     FROM games WHERE id = ?`,
  ).bind(c.get("gameId")).first<Omit<GameRow, "anon_meta" | "claim_secret_hash">>();
  if (!row) return jsonError(404, "game_not_found", "The game was not found.");
  return c.json({ game: { ...row, preview_url: previewUrl(c.env, row.slug) } });
});

games.delete("/api/v1/games/:id", gameAuthMiddleware, async (c) => {
  const result = await c.env.DB.prepare(
    "DELETE FROM games WHERE id = ? RETURNING id, slug",
  ).bind(c.get("gameId")).first<{ id: string; slug: string }>();
  if (!result) return jsonError(404, "game_not_found", "The game was not found.");
  return c.json({ deleted: true, game_id: result.id, slug: result.slug });
});
