import { execSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const winUnpacked = path.join(releaseDir, "win-unpacked");

if (process.platform !== "win32") {
  process.exit(0);
}

function killIfRunning(imageName) {
  try {
    execSync(`taskkill /IM ${imageName} /F /T`, { stdio: "ignore" });
  } catch {
    // Process was not running.
  }
}

async function removeWithRetries(target, attempts = 10) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
      return;
    } catch (error) {
      if (error?.code === "ENOENT") return;
      const retryable = error?.code === "EBUSY" || error?.code === "EPERM" || error?.code === "ENOTEMPTY";
      if (!retryable || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
}

// A previous unpacked build is often still running or held open by Explorer.
killIfRunning("Fragments.exe");
killIfRunning("electron.exe");

try {
  await removeWithRetries(winUnpacked);
} catch (error) {
  console.error(`[clean-release-win] Could not remove ${winUnpacked}: ${error.message}`);
  console.error("[clean-release-win] Close Fragments, any Explorer window on release/, then retry.");
  process.exit(1);
}
