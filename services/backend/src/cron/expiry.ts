import type { AppEnv } from "../types.js";
import { EXPIRY_BATCH_SIZE } from "../utils/anon-constants.js";

export async function runExpiry(env: AppEnv["Bindings"]): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE games
     SET state = 'cleaning', updated_at = datetime('now')
     WHERE id IN (
       SELECT id FROM games
       WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')
         AND state IN ('creating', 'open')
       ORDER BY expires_at ASC
       LIMIT ?
     )
     RETURNING id`,
  ).bind(EXPIRY_BATCH_SIZE).all<{ id: string }>();
  console.log(JSON.stringify({ event: "expiry_marked", count: result.results.length }));
  return result.results.length;
}
