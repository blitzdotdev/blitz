import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeManifest, manifestBytes, parseManifestFiles } from "../../src/utils/manifest.js";
import { checkBaseRelease } from "../../src/utils/releases.js";

describe("release manifests", () => {
  it("canonicalizes paths and descriptor keys before hashing", () => {
    const files = parseManifestFiles({
      "z.bin": { size: 4, mime: "application/octet-stream", sha256: "b".repeat(64) },
      "index.html": { size: 12, sha256: "a".repeat(64) },
    });
    const canonical = canonicalizeManifest(files);
    expect(canonical).toBe(`{"files":{"index.html":{"sha256":"${"a".repeat(64)}","size":12},"z.bin":{"sha256":"${"b".repeat(64)}","size":4,"mime":"application/octet-stream"}}}`);
    expect(createHash("sha256").update(canonical).digest("hex"))
      .toBe("bdd4b8c7ff5a374c434e85d3da00493203dc331574686992f1b3a79352e0d806");
    expect(manifestBytes(files)).toBe(16);
  });

  it("rejects traversal paths and malformed hashes", () => {
    expect(() => parseManifestFiles({ "../index.html": { sha256: "a".repeat(64), size: 1 } })).toThrow("invalid file path");
    expect(() => parseManifestFiles({ "index.html": { sha256: "nope", size: 1 } })).toThrow("invalid sha256");
  });
});

describe("release base guards", () => {
  it("accepts an omitted or current base and rejects invalid or moved hashes", () => {
    const active = "a".repeat(64);
    expect(checkBaseRelease(undefined, active)).toEqual({ ok: true });
    expect(checkBaseRelease(active, active)).toEqual({ ok: true });
    expect(checkBaseRelease("not-a-hash", active)).toEqual({ ok: false, reason: "invalid" });
    expect(checkBaseRelease("b".repeat(64), active)).toEqual({ ok: false, reason: "moved" });
  });
});
