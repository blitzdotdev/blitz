import { describe, expect, it } from "vitest";
import { publishingPage } from "../src/errors.js";
import { addEditorCors, allowedEditorOrigin, editorPreflight } from "../src/cors.js";
import { mimeForPath } from "../src/mime.js";
import { mapRequestPath, resolveGatewayTarget } from "../src/path.js";
import { parseRangeHeader } from "../src/range.js";

describe("gateway path mapping", () => {
  it("extracts custom-domain slugs", () => {
    expect(resolveGatewayTarget(new URL("https://space-race.app.blitz.dev/assets/a.glb"), "app.blitz.dev"))
      .toEqual({ slug: "space-race", requestPath: "/assets/a.glb" });
  });

  it("extracts workers.dev path-mode slugs", () => {
    expect(resolveGatewayTarget(new URL("https://blitz-game-gateway.example.workers.dev/space-race/assets/a.glb"), "app.blitz.dev"))
      .toEqual({ slug: "space-race", requestPath: "/assets/a.glb" });
  });

  it("maps directories and rejects traversal", () => {
    expect(mapRequestPath("/")).toBe("index.html");
    expect(mapRequestPath("/levels/")).toBe("levels/index.html");
    expect(mapRequestPath("/%2e%2e/secret")).toBeNull();
  });
});

describe("gateway MIME map", () => {
  it("covers game assets and explicit overrides", () => {
    expect(mimeForPath("scene.glb")).toBe("model/gltf-binary");
    expect(mimeForPath("scene.gltf")).toBe("model/gltf+json");
    expect(mimeForPath("module.wasm")).toBe("application/wasm");
    expect(mimeForPath("unknown.data")).toBe("application/octet-stream");
    expect(mimeForPath("scene.glb", "custom/type")).toBe("custom/type");
  });
});

describe("HTTP range parsing", () => {
  it("parses bounded, open, and suffix ranges", () => {
    expect(parseRangeHeader("bytes=0-3", 10)).toEqual({ offset: 0, length: 4, end: 3 });
    expect(parseRangeHeader("bytes=7-", 10)).toEqual({ offset: 7, length: 3, end: 9 });
    expect(parseRangeHeader("bytes=-4", 10)).toEqual({ offset: 6, length: 4, end: 9 });
  });

  it("rejects unsatisfiable or multiple ranges", () => {
    expect(parseRangeHeader("bytes=10-12", 10)).toBeNull();
    expect(parseRangeHeader("bytes=0-1,3-4", 10)).toBeNull();
  });
});

describe("publishing page", () => {
  it("returns the polling spinner contract", async () => {
    const response = publishingPage();
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-blitz-state")).toBe("publishing");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.text();
    expect(body).toContain("Publishing your game");
    expect(body).toContain("fetch(location.href,{cache:'no-store'})");
  });
});

describe("editor CORS", () => {
  it("uses the production editor and localhost defaults", () => {
    expect(allowedEditorOrigin("https://blitz-editor.blitzapp.workers.dev")).toBe("https://blitz-editor.blitzapp.workers.dev");
    expect(allowedEditorOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    expect(allowedEditorOrigin("https://example.com")).toBeNull();
  });

  it("adds CORS only for an explicitly allowed origin", () => {
    expect(allowedEditorOrigin("https://editor.example", " https://editor.example, http://localhost:5173 "))
      .toBe("https://editor.example");
    const response = addEditorCors(new Response("ok", { headers: { Vary: "Accept-Encoding" } }), "https://editor.example");
    expect(response.headers.get("access-control-allow-origin")).toBe("https://editor.example");
    expect(response.headers.get("access-control-expose-headers")).toBe("ETag, X-Blitz-State");
    expect(response.headers.get("vary")).toBe("Accept-Encoding, Origin");
  });

  it("handles GET and HEAD preflights and rejects other methods", () => {
    for (const method of ["GET", "HEAD"]) {
      const request = new Request("https://gateway.example/game/", {
        method: "OPTIONS",
        headers: { "Access-Control-Request-Method": method },
      });
      const response = editorPreflight(request, "https://editor.example");
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-methods")).toBe("GET, HEAD");
      expect(response.headers.get("access-control-allow-origin")).toBe("https://editor.example");
    }
    const rejected = editorPreflight(new Request("https://gateway.example/game/", {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Method": "POST" },
    }), "https://editor.example");
    expect(rejected.status).toBe(405);
  });
});
