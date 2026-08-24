// Main-process only: uses `node:crypto` and `node:fs`.

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Writes JSON via a temp file + rename so readers never observe a partial
 * write. The temp file is created exclusively, written, fsync'd, and closed
 * before the rename; if any step fails, the temp file is always removed so no
 * `.tmp` litter survives a failed write.
 */
export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const json = `${JSON.stringify(value, null, 2)}\n`;

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(tempPath, "wx");
    await handle.writeFile(json, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tempPath, filePath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}
