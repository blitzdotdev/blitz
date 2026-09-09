import { SHA256_RE } from "./validation.js";

export type BaseReleaseCheck =
  | { ok: true }
  | { ok: false; reason: "invalid" | "moved" };

export function checkBaseRelease(value: unknown, activeRelease: string | null): BaseReleaseCheck {
  if (value === undefined) return { ok: true };
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    return { ok: false, reason: "invalid" };
  }
  if (value !== activeRelease) return { ok: false, reason: "moved" };
  return { ok: true };
}
