import { describe, expect, it } from "vitest";
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
