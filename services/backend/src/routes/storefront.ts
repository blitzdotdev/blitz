import { Hono } from "hono";
import agentsMarkdown from "../../../../docs/agents.md";
import llmsText from "../static/llms.txt";
import type { AppEnv } from "../types.js";
import { ANON_SENTINEL_USER_ID } from "../utils/anon-constants.js";
import { jsonError } from "../utils/http.js";
import { previewUrl } from "../utils/preview.js";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const STORE_CACHE_CONTROL = "public, max-age=60, s-maxage=60";
const PLACEHOLDER_THUMBNAIL = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#191925"/><path d="m260 117 151 63v1l-151 63z" fill="#8b5cf6"/><circle cx="320" cy="180" r="112" fill="none" stroke="#36364a" stroke-width="10"/></svg>',
)}`;

interface StorefrontRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  author: string;
  manifest_json: string;
  release_created_at: string;
  updated_at: string;
}

interface StorefrontGame {
  slug: string;
  name: string;
  description: string | null;
  author: string;
  thumbnail_url: string;
  preview_url: string;
  updated_at: string;
}

interface PageCursor {
  release_created_at: string;
  game_id: string;
}

function parseLimit(value: string | null): number | null {
  if (value === null) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_LIMIT ? parsed : null;
}

function encodeCursor(cursor: PageCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(value: string | null): PageCursor | null | undefined {
  if (value === null) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const decoded: unknown = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return undefined;
    const candidate = decoded as Record<string, unknown>;
    if (typeof candidate.release_created_at !== "string" || !candidate.release_created_at
      || typeof candidate.game_id !== "string" || !candidate.game_id) return undefined;
    return { release_created_at: candidate.release_created_at, game_id: candidate.game_id };
  } catch {
    return undefined;
  }
}

function hasThumbnail(manifestJson: string): boolean {
  try {
    const parsed: unknown = JSON.parse(manifestJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const files = (parsed as Record<string, unknown>).files;
    return Boolean(files && typeof files === "object" && !Array.isArray(files)
      && Object.prototype.hasOwnProperty.call(files, "thumbnail.png"));
  } catch {
    return false;
  }
}

function toStorefrontGame(env: Env, row: StorefrontRow): StorefrontGame {
  const gamePreviewUrl = previewUrl(env, row.slug);
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    author: row.author,
    thumbnail_url: hasThumbnail(row.manifest_json)
      ? `${gamePreviewUrl}thumbnail.png`
      : PLACEHOLDER_THUMBNAIL,
    preview_url: gamePreviewUrl,
    updated_at: row.updated_at,
  };
}

async function listGames(env: Env, limit: number | null, cursor: PageCursor | null): Promise<{
  games: StorefrontGame[];
  nextCursor: string | null;
}> {
  const cursorClause = cursor
    ? "AND (r.created_at < ? OR (r.created_at = ? AND g.id < ?))"
    : "";
  const limitClause = limit === null ? "" : "LIMIT ?";
  const statement = env.DB.prepare(
    `SELECT g.id, g.slug, g.name, g.description, u.username AS author,
            r.manifest_json, r.created_at AS release_created_at, g.updated_at
     FROM games AS g
     JOIN users AS u ON u.id = g.owner_id
     JOIN releases AS r ON r.game_id = g.id AND r.release_hash = g.active_release
     WHERE g.listed = 1 AND g.owner_id <> ? ${cursorClause}
     ORDER BY r.created_at DESC, g.id DESC
     ${limitClause}`,
  );
  const values: Array<string | number> = [ANON_SENTINEL_USER_ID];
  if (cursor) values.push(cursor.release_created_at, cursor.release_created_at, cursor.game_id);
  if (limit !== null) values.push(limit + 1);
  const result = await statement.bind(...values).all<StorefrontRow>();
  const page = limit === null ? result.results : result.results.slice(0, limit);
  const last = page.at(-1);
  return {
    games: page.map((row) => toStorefrontGame(env, row)),
    nextCursor: limit !== null && result.results.length > limit && last
      ? encodeCursor({ release_created_at: last.release_created_at, game_id: last.id })
      : null,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function renderStorefront(games: StorefrontGame[]): string {
  const cards = games.map((game) => {
    const description = game.description
      ? `<p class="description">${escapeHtml(game.description)}</p>`
      : "";
    return `<article class="card" data-search="${escapeHtml(`${game.name} ${game.author}`.toLowerCase())}">
  <img src="${escapeHtml(game.thumbnail_url)}" alt="" loading="lazy" width="640" height="360">
  <div class="details"><h2>${escapeHtml(game.name)}</h2><p class="author">by ${escapeHtml(game.author)}</p>${description}
    <a class="play" href="${escapeHtml(game.preview_url)}">Play</a></div>
</article>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blitz: Play games</title>
<style>
:root{color-scheme:dark;font:16px/1.5 system-ui,sans-serif;background:#0d0d14;color:#f7f7fb}*{box-sizing:border-box}body{margin:0}main,footer{width:min(1120px,calc(100% - 32px));margin:auto}header{padding:64px 0 28px}h1{font-size:clamp(2.3rem,7vw,4.7rem);line-height:1;margin:0 0 12px}.intro{color:#aaaabd;margin:0 0 28px}input{width:100%;padding:15px 18px;border:1px solid #353547;border-radius:12px;background:#171722;color:inherit;font:inherit}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:22px;padding:8px 0 64px}.card{overflow:hidden;border:1px solid #292938;border-radius:16px;background:#171722}.card img{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;background:#191925}.details{padding:18px}.details h2{margin:0;font-size:1.2rem}.author,.description{color:#aaaabd;margin:3px 0 14px}.description{min-height:3em}.play{display:inline-block;padding:9px 17px;border-radius:9px;background:#7657ff;color:white;text-decoration:none;font-weight:700}.empty{color:#aaaabd}footer{padding:0 0 36px;color:#77778a}footer a{color:#aaaabd}
</style></head><body><main><header><h1>Play something new.</h1><p class="intro">Games made and published with Blitz.</p>
<input id="search" type="search" placeholder="Search games" aria-label="Search games"></header>
<section class="grid" id="games">${cards || '<p class="empty">No games published yet.</p>'}</section></main>
<footer><a href="/agents.md">Build with an agent</a></footer>
<script>
const search=document.querySelector('#search');
const cards=[...document.querySelectorAll('.card')];
search.addEventListener('input',()=>{
  const query=search.value.trim().toLowerCase();
  for(const card of cards){
    card.hidden=!card.dataset.search.includes(query);
  }
});
</script></body></html>`;
}

export const storefront = new Hono<AppEnv>();

storefront.get("/api/v1/games", async (c) => {
  const limit = parseLimit(new URL(c.req.url).searchParams.get("limit"));
  if (limit === null) return jsonError(400, "invalid_limit", `limit must be an integer from 1 to ${MAX_LIMIT}.`);
  const cursor = decodeCursor(new URL(c.req.url).searchParams.get("cursor"));
  if (cursor === undefined) return jsonError(400, "invalid_cursor", "cursor is invalid.");
  const page = await listGames(c.env, limit, cursor);
  return c.json({ games: page.games, next_cursor: page.nextCursor });
});

storefront.get("/", async (c) => {
  const cacheKey = new Request(c.req.url, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;
  const page = await listGames(c.env, null, null);
  const response = c.html(renderStorefront(page.games), 200, { "Cache-Control": STORE_CACHE_CONTROL });
  c.executionCtx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
});

storefront.get("/agents.md", (c) => c.body(agentsMarkdown, 200, {
  "Content-Type": "text/markdown; charset=utf-8",
}));

storefront.get("/llms.txt", (c) => c.body(llmsText, 200, {
  "Content-Type": "text/plain; charset=utf-8",
}));
