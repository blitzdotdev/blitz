import type { AppEnv } from "../types.js";
import { CLEANUP_GRACE_SECONDS, EXPIRY_BATCH_SIZE } from "../utils/anon-constants.js";

export async function runCleanup(env: AppEnv["Bindings"]): Promise<number> {
  const result = await env.DB.prepare(
    `DELETE FROM games
     WHERE id IN (
       SELECT id FROM games
       WHERE state = 'cleaning'
         AND updated_at <= datetime('now', ?)
       ORDER BY updated_at ASC
       LIMIT ?
     )
     RETURNING id`,
  ).bind(`-${CLEANUP_GRACE_SECONDS} seconds`, EXPIRY_BATCH_SIZE).all<{ id: string }>();
  // ON DELETE CASCADE removes releases and game_tokens. Shared R2 blobs remain.
  console.log(JSON.stringify({ event: "expiry_cleaned", count: result.results.length }));
  return result.results.length;
}
