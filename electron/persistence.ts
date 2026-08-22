// @ts-nocheck
import { app, dialog, ipcMain, net, protocol } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const AUDIO_SCHEME = "fragments-audio";
const nativeImport = new Function("specifier", "return import(specifier)");

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
  console.log("[fragments] library root:", libraryRoot);
}
