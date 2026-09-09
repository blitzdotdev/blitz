import { Hono } from "hono";
import type { AppEnv, GameRow } from "../types.js";
import {
  AGENT_TOKEN_PREFIX,
  ANON_KV_KEYS,
  ANON_SENTINEL_USER_ID,
  ANON_TTL_HOURS,
} from "../utils/anon-constants.js";
import { randomBase64Url, sha256Hex } from "../utils/crypto.js";
import { jsonError, positiveInteger } from "../utils/http.js";
import { previewUrl } from "../utils/preview.js";
import { slugError } from "../utils/validation.js";

export const anonGames = new Hono<AppEnv>();

async function kvWindowAllowed(kv: KVNamespace, scope: string, key: string, limit: number): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000);
  const storageKey = `anon:rl:${scope}:${minute}:${key}`;
  const current = Number(await kv.get(storageKey) ?? "0");
  if (Number.isFinite(current) && current >= limit) return false;
  await kv.put(storageKey, String((Number.isFinite(current) ? current : 0) + 1), { expirationTtl: 120 });
  return true;
}

anonGames.post("/api/v1/new-game/:slug", async (c) => {
  if ((await c.env.ANON_TRIPWIRE.get(ANON_KV_KEYS.LOCKDOWN)) === "true") {
    return jsonError(503, "service_unavailable", "Anonymous game creation is temporarily disabled.", {}, { "Retry-After": "3600" });
  }

  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const cf = c.req.raw.cf as { asn?: number } | undefined;
  const asn = typeof cf?.asn === "number" ? String(cf.asn) : null;
  const ipNative = await c.env.ANON_RL_IP.limit({ key: ip });
  if (!ipNative.success || !await kvWindowAllowed(c.env.ANON_TRIPWIRE, "ip", ip, 10)) {
    return jsonError(429, "rate_limited", "Rate limit exceeded for this IP.", { scope: "ip" }, { "Retry-After": "60" });
  }
  if (asn) {
    const asnNative = await c.env.ANON_RL_ASN.limit({ key: asn });
    if (!asnNative.success || !await kvWindowAllowed(c.env.ANON_TRIPWIRE, "asn", asn, 100)) {
      return jsonError(429, "rate_limited", "Rate limit exceeded for this ASN.", { scope: "asn" }, { "Retry-After": "60" });
    }
  }

  const slug = c.req.param("slug");
  const validation = slugError(slug);
  if (validation === "invalid_slug") {
    return jsonError(400, validation, "Slug must be 3-49 lowercase alphanumeric characters or hyphens, with no double hyphen.");
  }
  if (validation === "reserved_slug") return jsonError(400, validation, `Slug '${slug}' is reserved.`);

  const url = new URL(c.req.url);
  const name = (url.searchParams.get("name") ?? slug).trim();
  if (!name || name.length > 100) return jsonError(400, "invalid_name", "Name must be 1-100 characters.");
  const sourceSlug = url.searchParams.get("source");
  if (sourceSlug && slugError(sourceSlug)) return jsonError(400, "invalid_source", "The source slug is invalid.");

  const existing = await c.env.DB.prepare("SELECT 1 FROM games WHERE slug = ?").bind(slug).first();
  if (existing) return jsonError(409, "slug_taken", `Slug '${slug}' is already taken.`);

  let source: (GameRow & { manifest_json: string | null; message: string | null }) | null = null;
  if (sourceSlug) {
    source = await c.env.DB.prepare(
      `SELECT g.*, r.manifest_json, r.message
       FROM games g
       LEFT JOIN releases r ON r.game_id = g.id AND r.release_hash = g.active_release
       WHERE g.slug = ? AND g.visibility = 'public' AND g.state = 'open'
         AND (g.expires_at IS NULL OR g.expires_at > datetime('now'))
       LIMIT 1`,
    ).bind(sourceSlug).first<GameRow & { manifest_json: string | null; message: string | null }>();
    if (!source) return jsonError(404, "source_not_found", `Source game '${sourceSlug}' was not found or is not forkable.`);
  }

  const ttlHours = positiveInteger(c.env.ANON_TTL_HOURS, ANON_TTL_HOURS);
  const expiry = await c.env.DB.prepare("SELECT datetime('now', ?) AS expires_at")
    .bind(`+${ttlHours} hours`).first<{ expires_at: string }>();
  if (!expiry?.expires_at) return jsonError(500, "expiry_failed", "Could not calculate the game expiry.");

  const gameId = crypto.randomUUID();
  const deployToken = `${AGENT_TOKEN_PREFIX}${randomBase64Url(32)}`;
  const claimSecret = randomBase64Url(32);
  const [tokenHash, claimSecretHash] = await Promise.all([
    sha256Hex(deployToken),
    sha256Hex(claimSecret),
  ]);
  const releaseId = source?.active_release && source.manifest_json ? crypto.randomUUID() : null;
  const anonMeta = JSON.stringify({ creator_ip: ip, creator_asn: asn });

  const statements = [
    c.env.DB.prepare(
      `INSERT INTO games
       (id, owner_id, slug, name, state, visibility, expires_at, anon_meta, claim_secret_hash, active_release, bytes_used)
       VALUES (?, ?, ?, ?, 'open', 'public', ?, ?, ?, ?, ?)`,
    ).bind(
      gameId,
      ANON_SENTINEL_USER_ID,
      slug,
      name,
      expiry.expires_at,
      anonMeta,
      claimSecretHash,
      source?.active_release ?? null,
      source?.bytes_used ?? 0,
    ),
    c.env.DB.prepare(
      `INSERT INTO game_tokens (id, game_id, name, token_hash, token_prefix)
       VALUES (?, ?, 'anon-agent', ?, ?)`,
    ).bind(crypto.randomUUID(), gameId, tokenHash, deployToken.slice(0, 8)),
  ];
  if (releaseId && source?.active_release && source.manifest_json) {
    statements.push(c.env.DB.prepare(
      `INSERT INTO releases (id, release_hash, game_id, manifest_json, message)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(releaseId, source.active_release, gameId, source.manifest_json, `Forked from ${sourceSlug}`));
  }

  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|constraint/i.test(message)) return jsonError(409, "slug_taken", `Slug '${slug}' is already taken.`);
    throw error;
  }

  return c.json({
    game_id: gameId,
    slug,
    name,
    state: "open",
    expires_at: expiry.expires_at,
    preview_url: previewUrl(c.env, slug),
    deploy_token: deployToken,
    claim_secret: claimSecret,
    claim_url: `${url.origin}/api/v1/games/${encodeURIComponent(slug)}/claim`,
  }, 201);
});
