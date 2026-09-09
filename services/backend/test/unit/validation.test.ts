import { describe, expect, it } from "vitest";
import { RESERVED_SLUGS, slugError } from "../../src/utils/validation.js";

describe("slug validation", () => {
  it("accepts global game slugs", () => {
    expect(slugError("my-game-42")).toBeNull();
    expect(slugError("abc")).toBeNull();
    expect(slugError("a".repeat(49))).toBeNull();
  });

  it("rejects malformed and reserved slugs", () => {
    expect(slugError("ab")).toBe("invalid_slug");
    expect(slugError("Uppercase")).toBe("invalid_slug");
    expect(slugError("bad--slug")).toBe("invalid_slug");
    expect(RESERVED_SLUGS.has("api")).toBe(true);
    expect(slugError("api")).toBe("reserved_slug");
  });
});
