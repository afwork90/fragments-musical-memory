// Bundles the preload into a single file with no relative requires.
//
// This is not an optimisation. The window is created with `sandbox: true`, and a
// sandboxed preload does not get Node's module resolver: its `require` is a small
// polyfill that serves `electron` and a handful of built-ins and nothing else. A
// relative specifier fails at runtime with
//
//   Unable to load preload script: .../electron-dist/electron/preload.js
//   Error: module not found: ../lib/ipc/contract.js
//
// and — this is the dangerous part — the failure is confined to that one log line.
// The window still opens, the renderer still runs, `window.fragments` is simply
// never defined, and `getFragmentsBridge()` quietly falls back to the HTTP bridge
// meant for the browser preview. Under `dev:all` that bridge even loads the real
// library from the dev server, so the app looks entirely normal while every write
// silently does nothing. It went unnoticed for the whole of the modular refactor.
//
// So the preload must be self-contained, and the alternatives are worse: turning the
// sandbox off weakens the window for a build problem, and hand-copying the channel
// names into the preload gives up the single definition site that makes a typo a
// compile error. `tsc` still typechecks `preload.ts` against `FragmentsBridge`; this
// step only decides what reaches disk.
//
// Everything else under `electron-dist/` runs in the main process with full Node, so
// only this one file needs bundling.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(electronDir, "..");

await build({
  entryPoints: [path.join(electronDir, "preload.ts")],
  outfile: path.join(repoRoot, "electron-dist", "electron", "preload.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  // Provided by the sandboxed preload's own require.
  external: ["electron"],
  logLevel: "warning",
});
