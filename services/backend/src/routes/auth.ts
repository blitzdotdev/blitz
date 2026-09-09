import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../types.js";
import { platformAuthMiddleware } from "../middleware/agent-auth.js";
import { jsonError, readJsonObject } from "../utils/http.js";

export function createAuthRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  async function callTeenyAuth(c: Context<AppEnv>, path: string, body: object): Promise<Response> {
    return app.fetch(new Request(new URL(path, c.req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }), c.env, c.executionCtx);
  }

  routes.post("/api/v1/auth/register", async (c) => {
    const body = await readJsonObject(c.req.raw);
    if (!body) return jsonError(400, "bad_request", "A JSON body is required.");
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(username) || password.length < 8) {
      return jsonError(400, "invalid_registration", "email, an alphanumeric username, and a password of at least 8 characters are required.");
    }

    const response = await callTeenyAuth(c, "/api/v1/table/users/auth/sign-up", {
      email,
      username,
      password,
      passwordConfirm: password,
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : username,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) return Response.json(payload, { status: response.status });
    const result = payload as { token?: string; refresh_token?: string; record?: unknown };
    return Response.json({ user: result.record, token: result.token, refresh_token: result.refresh_token }, { status: 201 });
  });

  routes.post("/api/v1/auth/login", async (c) => {
    const body = await readJsonObject(c.req.raw);
    if (!body) return jsonError(400, "bad_request", "A JSON body is required.");
    const identity = typeof body.identity === "string" ? body.identity.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!identity || !password) return jsonError(400, "invalid_login", "identity and password are required.");

    const response = await callTeenyAuth(c, "/api/v1/table/users/auth/login-password", { identity, password });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) return Response.json(payload, { status: response.status });
    const result = payload as { token?: string; refresh_token?: string; record?: unknown };
    return Response.json({ user: result.record, token: result.token, refresh_token: result.refresh_token });
  });

  routes.get("/api/v1/auth/me", platformAuthMiddleware, async (c) => {
    const user = await c.env.DB.prepare(
      "SELECT id, username, email, email_verified, name, avatar, role, status, created, updated FROM users WHERE id = ?",
    ).bind(c.get("userId")).first();
    if (!user) return jsonError(404, "user_not_found", "The user no longer exists.");
    return c.json({ user });
  });

  return routes;
}
