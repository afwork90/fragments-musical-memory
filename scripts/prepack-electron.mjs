import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cleanWin = path.join(root, "scripts", "clean-release-win.mjs");

if (process.platform === "win32") {
  const result = spawnSync(process.execPath, [cleanWin], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
