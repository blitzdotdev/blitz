import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeManifest, manifestBytes, parseManifestFiles } from "../../src/utils/manifest.js";

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
