import type { AppEnv } from "../types.js";
import { decrementGameBlobRefsStatement } from "../utils/blob-refs.js";
import { CLEANUP_GRACE_SECONDS, EXPIRY_BATCH_SIZE } from "../utils/anon-constants.js";

export async function runCleanup(env: AppEnv["Bindings"]): Promise<number> {
  const eligible = await env.DB.prepare(
    `SELECT id FROM games
     WHERE state = 'cleaning'
       AND updated_at <= datetime('now', ?)
     ORDER BY updated_at ASC
     LIMIT ?`,
  ).bind(`-${CLEANUP_GRACE_SECONDS} seconds`, EXPIRY_BATCH_SIZE).all<{ id: string }>();
  if (eligible.results.length === 0) {
    console.log(JSON.stringify({ event: "expiry_cleaned", count: 0 }));
    return 0;
  }

  const statements: D1PreparedStatement[] = [];
  for (const game of eligible.results) {
    statements.push(decrementGameBlobRefsStatement(env.DB, game.id));
    statements.push(env.DB.prepare("DELETE FROM games WHERE id = ?").bind(game.id));
  }
  const results = await env.DB.batch(statements);
  const count = results.reduce((total, result, index) => (
    index % 2 === 1 ? total + (result.meta.changes ?? 0) : total
  ), 0);
  console.log(JSON.stringify({ event: "expiry_cleaned", count }));
  return count;
}
