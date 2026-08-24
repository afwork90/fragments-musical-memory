// Path guards for the managed library. Main-process only: uses `node:path`.

import path from "node:path";

const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export const LIBRARY_DIR_NAME = "Fragments Library";

/**
 * One rule for where the library lives, so Electron, the dev server that backs the
 * web build, and the seed script cannot disagree about it. Callers supply their
 * own documents directory because only Electron can ask the OS for it.
 */
export function resolveLibraryRoot(documentsDir: string): string {
  return process.env.FRAGMENTS_LIBRARY_ROOT || path.join(documentsDir, LIBRARY_DIR_NAME);
}

export function assertSafeSourceId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0 || !SAFE_ID_PATTERN.test(id) || id === "." || id === "..") {
    throw new Error("source id must be a non-empty identifier without path traversal segments");
  }
  return id;
}

export function assertSafeRelativeFilename(filename: unknown, label = "audioFile"): string {
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error(`${label} must be a non-empty relative filename`);
  }
  if (filename.includes("/") || filename.includes("\\")) {
    throw new Error(`${label} must not contain path separators`);
  }
  if (filename === "." || filename === "..") {
    throw new Error(`${label} must not be a relative path segment`);
  }
  return filename;
}

/** Resolves `filename` inside `dir`, rejecting any result that escapes it. */
export function resolveWithinDir(dir: string, filename: string): string {
  const resolvedDir = path.resolve(dir);
  const resolved = path.resolve(resolvedDir, filename);
  const prefix = `${resolvedDir}${path.sep}`;
  if (resolved !== resolvedDir && !resolved.startsWith(prefix)) {
    throw new Error("resolved path escapes its managed directory (traversal rejected)");
  }
  return resolved;
}
