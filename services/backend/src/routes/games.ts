import { Hono } from "hono";
import type { AppEnv, GameRow } from "../types.js";
import { gameAuthMiddleware } from "../middleware/agent-auth.js";
import { decrementGameBlobRefsStatement } from "../utils/blob-refs.js";
import { jsonError, readJsonObject } from "../utils/http.js";
import { previewUrl } from "../utils/preview.js";

export const games = new Hono<AppEnv>();

games.get("/api/v1/games/:id", gameAuthMiddleware, async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT id, owner_id, slug, name, description, listed, state, visibility, expires_at,
            active_release, bytes_used, created_at, updated_at
     FROM games WHERE id = ?`,
  ).bind(c.get("gameId")).first<Omit<GameRow, "anon_meta" | "claim_secret_hash">>();
  if (!row) return jsonError(404, "game_not_found", "The game was not found.");
  return c.json({ game: { ...row, listed: row.listed === 1, preview_url: previewUrl(c.env, row.slug) } });
});

games.patch("/api/v1/games/:id", gameAuthMiddleware, async (c) => {
  const body = await readJsonObject(c.req.raw);
  if (!body) return jsonError(400, "bad_request", "A JSON body is required.");

  const updates: string[] = [];
  const values: Array<string | number> = [];
  if (body.name !== undefined) {
    if (typeof body.name !== "string") return jsonError(400, "invalid_name", "name must be a string.");
    const name = body.name.trim();
    if (!name || name.length > 100) return jsonError(400, "invalid_name", "name must be 1-100 characters.");
    updates.push("name = ?");
    values.push(name);
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string" || body.description.length > 500) {
      return jsonError(400, "invalid_description", "description must be a string of at most 500 characters.");
    }
    updates.push("description = ?");
    values.push(body.description.trim());
  }
  if (body.listed !== undefined) {
    if (typeof body.listed !== "boolean") return jsonError(400, "invalid_listed", "listed must be a boolean.");
    updates.push("listed = ?");
    values.push(body.listed ? 1 : 0);
  }
  if (!updates.length) {
    return jsonError(400, "invalid_update", "At least one of name, description, or listed is required.");
  }

  values.push(c.get("gameId"));
  const row = await c.env.DB.prepare(
    `UPDATE games SET ${updates.join(", ")}, updated_at = datetime('now')
     WHERE id = ?
     RETURNING id, owner_id, slug, name, description, listed, state, visibility,
               expires_at, active_release, bytes_used, created_at, updated_at`,
  ).bind(...values).first<Omit<GameRow, "anon_meta" | "claim_secret_hash">>();
  if (!row) return jsonError(404, "game_not_found", "The game was not found.");
  return c.json({ game: { ...row, listed: row.listed === 1, preview_url: previewUrl(c.env, row.slug) } });
});

games.delete("/api/v1/games/:id", gameAuthMiddleware, async (c) => {
  const gameId = c.get("gameId");
  const results = await c.env.DB.batch([
    decrementGameBlobRefsStatement(c.env.DB, gameId),
    c.env.DB.prepare("DELETE FROM games WHERE id = ? RETURNING id, slug").bind(gameId),
  ]);
  const result = results[1]?.results[0] as { id: string; slug: string } | undefined;
  if (!result) return jsonError(404, "game_not_found", "The game was not found.");
  return c.json({ deleted: true, game_id: result.id, slug: result.slug });
});
