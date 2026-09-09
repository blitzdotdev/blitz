import type { ManifestFile, ReleaseManifest } from "../types.js";
import { isValidManifestPath, SHA256_RE } from "./validation.js";

export class ManifestValidationError extends Error {}

export function canonicalizeManifest(files: Record<string, ManifestFile>): string {
  const sorted: Record<string, ManifestFile> = {};
  for (const path of Object.keys(files).sort()) {
    const file = files[path];
    sorted[path] = file.mime
      ? { sha256: file.sha256, size: file.size, mime: file.mime }
      : { sha256: file.sha256, size: file.size };
  }
  return JSON.stringify({ files: sorted } satisfies ReleaseManifest);
}

export function parseManifestFiles(value: unknown): Record<string, ManifestFile> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ManifestValidationError("files must be an object");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) throw new ManifestValidationError("files must not be empty");
  if (entries.length > 2_000) throw new ManifestValidationError("files exceeds the 2000-file limit");

  const files: Record<string, ManifestFile> = {};
  for (const [path, raw] of entries) {
    if (!isValidManifestPath(path)) throw new ManifestValidationError(`invalid file path: ${path}`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ManifestValidationError(`invalid descriptor for ${path}`);
    }
    const descriptor = raw as Record<string, unknown>;
    const sha256 = descriptor.sha256;
    const size = descriptor.size;
    const mime = descriptor.mime;
    if (typeof sha256 !== "string" || !SHA256_RE.test(sha256)) {
      throw new ManifestValidationError(`invalid sha256 for ${path}`);
    }
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      throw new ManifestValidationError(`invalid size for ${path}`);
    }
    if (mime !== undefined && (typeof mime !== "string" || mime.length === 0 || mime.length > 200 || /[\r\n]/.test(mime))) {
      throw new ManifestValidationError(`invalid mime for ${path}`);
    }
    files[path] = mime ? { sha256, size, mime } : { sha256, size };
  }
  return files;
}

export function manifestBytes(files: Record<string, ManifestFile>): number {
  let total = 0;
  for (const file of Object.values(files)) {
    total += file.size;
    if (!Number.isSafeInteger(total)) throw new ManifestValidationError("manifest byte total is too large");
  }
  return total;
}
