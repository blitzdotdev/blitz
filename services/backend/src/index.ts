import { Hono } from "hono";
import { $Database, D1Adapter, teenyHono } from "teenybase/worker";
import config from "virtual:teenybase";
import type { AppEnv } from "./types.js";
import { anonGames } from "./routes/anon-games.js";
import { blobs } from "./routes/blobs.js";
import { claims } from "./routes/claims.js";
import { games } from "./routes/games.js";
import { releases } from "./routes/releases.js";
import { tokens } from "./routes/tokens.js";
import { createAuthRoutes } from "./routes/auth.js";
import { runCleanup } from "./cron/cleanup.js";
import { runExpiry } from "./cron/expiry.js";
import { jsonError } from "./utils/http.js";

const baseApp = new Hono<AppEnv>();
const app = teenyHono<AppEnv>(async (c) => {
  return new $Database(c, config, new D1Adapter(c.env.DB));
}, baseApp, {
  logger: false,
  cors: {
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type", "If-None-Match", "Range"],
    allowMethods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
  },
  onError(error, c) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(JSON.stringify({ event: "request_error", path: c.req.path, message }));
    return jsonError(500, "internal_error", "An internal error occurred.",
      c.env.RESPOND_WITH_ERRORS === "true" ? { detail: message } : {});
  },
});

app.route("/", createAuthRoutes(app));
app.route("/", anonGames);
app.route("/", blobs);
app.route("/", releases);
app.route("/", claims);
app.route("/", tokens);
app.route("/", games);

app.get("/health", (c) => c.json({ status: "ok", service: "blitz-backend" }));
app.notFound(() => jsonError(404, "not_found", "Route not found."));

export { app };

export default {
  fetch: app.fetch.bind(app),
  async scheduled(_controller, env): Promise<void> {
    // Clean rows marked by earlier ticks, then mark the next overdue batch.
    await runCleanup(env);
    await runExpiry(env);
  },
} satisfies ExportedHandler<Env>;
