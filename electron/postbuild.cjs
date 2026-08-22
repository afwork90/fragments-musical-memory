// The root package.json sets "type": "module", which would make Node treat the
// compiled main process as ESM. Electron's native binding has no ESM named
// exports, so the output directory is pinned back to CommonJS.
const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const outDir = join(__dirname, "..", "electron-dist");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
