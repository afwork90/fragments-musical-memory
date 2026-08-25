// The preload is the one file in `electron-dist/` that cannot use Node's module
// resolver, because the window is created with `sandbox: true`. A sandboxed
// preload's `require` serves `electron` and a few built-ins; anything else throws
// "module not found" at load time.
//
// That failure is nearly invisible — one line in the Electron log, the window opens
// anyway, and the renderer falls back to the HTTP bridge intended for the browser
// preview, so the app looks normal while every write does nothing. It survived a
// whole refactor unnoticed for exactly that reason, which is why this asserts on the
// build output rather than trusting the build to stay correct.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const preloadPath = path.join(repoRoot, "electron-dist", "electron", "preload.js");

test("the built preload requires nothing a sandboxed preload cannot resolve", async () => {
  const source = await readFile(preloadPath, "utf8");
  const specifiers = [...source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]);

  assert.deepEqual([...new Set(specifiers)].sort(), ["electron"]);
});

test("the built preload still exposes the bridge and its channels", async () => {
  const source = await readFile(preloadPath, "utf8");

  // Bundled, not hand-copied: the channel strings have to arrive from
  // `lib/ipc/contract.ts` for the typed contract to mean anything.
  assert.match(source, /exposeInMainWorld\(\s*["']fragments["']/);
  assert.match(source, /fragments:list-sources/);
});
