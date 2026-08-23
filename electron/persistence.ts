// @ts-nocheck
import { app, dialog, ipcMain, nativeImage, net, protocol } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRendererPath } from "./protocols/resolve-renderer-path.js";

const AUDIO_SCHEME = "fragments-audio";
const nativeImport = new Function("specifier", "return import(specifier)");

// `startDrag` requires a non-empty icon on macOS. Electron's own native-drag
// tutorial writes the icon to a real file on disk and passes a path (rather
// than an in-memory NativeImage) - mirroring that exactly here in case some
// drop targets are pickier about how the icon is supplied.
function dragIcon() {
  const size = 32;
  const buffer = Buffer.alloc(size * size * 4);
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = 0xff; // B
    buffer[i + 1] = 0xd8; // G
    buffer[i + 2] = 0x74; // R (#74d8ff accent)
    buffer[i + 3] = 0xff; // A
  }
  const image = nativeImage.createFromBitmap(buffer, { width: size, height: size });
  const iconPath = path.join(app.getPath("temp"), "fragments-drag-icon.png");
  fs.writeFileSync(iconPath, image.toPNG());
  return iconPath;
}

export function registerAudioScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: AUDIO_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }]);
}

export async function initializePersistence() {
  const modulePath = app.isPackaged
    ? path.join(process.resourcesPath, "library-service.mjs")
    : path.join(app.getAppPath(), "lib", "domain", "library-service.mjs");
  const { createLibraryService } = await nativeImport(pathToFileURL(modulePath).href);
  const libraryRoot = process.env.FRAGMENTS_LIBRARY_ROOT
    || path.join(app.getPath("documents"), "Fragments Library");
  const library = createLibraryService(libraryRoot);
  const audioUrl = (id) => `${AUDIO_SCHEME}://source/${encodeURIComponent(id)}`;

  protocol.handle(AUDIO_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== "source") return new Response("Not found", { status: 404 });
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const source = (await library.listSources()).find((item) => item.id === id);
    if (!source) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(library.resolveAudioPath(id, source.audioFile)).href);
  });

  function logged(channel, handler) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...args);
      } catch (error) {
        console.error(`[fragments] ${channel} failed:`, error);
        throw error;
      }
    });
  }

  logged("fragments:pick-audio", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "aif", "aiff", "flac", "ogg"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  logged("fragments:begin-import", async (_event, filePath) => {
    const source = await library.beginImport(filePath);
    return { ...source, audioUrl: audioUrl(source.id) };
  });
  logged("fragments:finalize-import", async (_event, id, metadata) => {
    const source = await library.finalizeImport(id, metadata);
    return { ...source, audioUrl: audioUrl(source.id) };
  });
  logged("fragments:cancel-import", (_event, id) => library.cancelImport(id));
  logged("fragments:list-sources", async () => (
    (await library.listSources())
      .filter((source) => source.duration)
      .map((source) => ({ ...source, audioUrl: audioUrl(source.id) }))
  ));
  logged("fragments:update-source-analysis", async (_event, id, analysis) => {
    const source = await library.updateSourceAnalysis(id, analysis);
    return { ...source, audioUrl: audioUrl(source.id) };
  });

  const icon = dragIcon();
  const publicAssetsRoot = process.env.ELECTRON_RENDERER_URL
    ? path.join(process.cwd(), "public")
    : path.join(app.getAppPath(), "dist", "client");

  // The library (and, in dev, the bundled public assets) live under
  // ~/Documents, a TCC-protected folder on macOS. Drags initiated by Finder
  // get an OS-level access exception, but drags initiated by a non-Finder
  // app into that same folder can silently fail to deliver file bytes to the
  // receiving app even though drag metadata (name/extension) comes through -
  // some DAWs show a placeholder and then drop nothing. Staging a throwaway
  // copy in the (unprotected) temp folder before dragging works around this.
  async function stageForDrag(filePath, label) {
    const stagingDir = path.join(app.getPath("temp"), "fragments-drag-staging");
    await fs.promises.mkdir(stagingDir, { recursive: true });
    const extension = path.extname(filePath) || ".wav";
    const safeLabel = String(label || "audio").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "audio";
    const staged = path.join(stagingDir, `${safeLabel}${extension}`);
    await fs.promises.copyFile(filePath, staged);
    return staged;
  }

  ipcMain.on("fragments:start-drag", async (event, target) => {
    try {
      const sourceId = typeof target === "string" ? target : target?.sourceId;
      const assetPath = typeof target === "object" ? target?.assetPath : null;
      let filePath = null;
      if (sourceId) {
        const source = (await library.listSources()).find((item) => item.id === sourceId);
        if (source) filePath = library.resolveAudioPath(sourceId, source.audioFile);
      }
      if (!filePath && assetPath) {
        filePath = resolveRendererPath(publicAssetsRoot, assetPath);
      }
      if (!filePath) return;
      const label = sourceId || path.basename(assetPath || filePath, path.extname(filePath));
      const staged = await stageForDrag(filePath, label).catch((error) => {
        console.error("[fragments] drag staging failed, dragging original path:", error);
        return filePath;
      });
      event.sender.startDrag({ file: staged, icon });
    } catch (error) {
      console.error("[fragments] start-drag failed:", error);
    }
  });

  console.log("[fragments] library root:", libraryRoot);
}
