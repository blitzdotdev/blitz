import type { Context } from "hono";
import type { AppEnv } from "../types.js";
import { jsonError } from "./http.js";

async function kvWindowAllowed(kv: KVNamespace, key: string, limit: number): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000);
  const storageKey = `anon:rl:ip:${minute}:${key}`;
  const current = Number(await kv.get(storageKey) ?? "0");
  if (Number.isFinite(current) && current >= limit) return false;
  await kv.put(storageKey, String((Number.isFinite(current) ? current : 0) + 1), { expirationTtl: 120 });
  return true;
}

export async function enforceCreationIpRateLimit(c: Context<AppEnv>): Promise<Response | null> {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const native = await c.env.ANON_RL_IP.limit({ key: ip });
  if (!native.success || !await kvWindowAllowed(c.env.ANON_TRIPWIRE, ip, 10)) {
    return jsonError(429, "rate_limited", "Rate limit exceeded for this IP.", { scope: "ip" }, { "Retry-After": "60" });
  }
  return null;
}
