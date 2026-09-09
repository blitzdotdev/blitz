import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { enforceCreationIpRateLimit } from "../utils/rate-limit.js";
import { slugError } from "../utils/validation.js";

export const slugs = new Hono<AppEnv>();

slugs.get("/api/v1/slugs/:slug", async (c) => {
  const rateLimitError = await enforceCreationIpRateLimit(c);
  if (rateLimitError) return rateLimitError;

  const slug = c.req.param("slug");
  const reason = slugError(slug);
  if (reason) return c.json({ slug, available: false, reason });

  const existing = await c.env.DB.prepare("SELECT 1 FROM games WHERE slug = ? LIMIT 1")
    .bind(slug).first();
  if (existing) return c.json({ slug, available: false, reason: "slug_taken" as const });
  return c.json({ slug, available: true });
});
