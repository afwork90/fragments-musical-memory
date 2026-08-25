import { app, dialog, ipcMain, nativeImage, protocol } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { resolveRendererPath } from "./protocols/resolve-renderer-path.js";
import { audioMimeType, parseByteRange } from "../lib/domain/audio-serving.js";
import { createLibraryService } from "../lib/domain/library-service.js";
import { resolveLibraryRoot } from "../lib/domain/paths.js";
import { FRAGMENTS_CHANNELS } from "../lib/ipc/contract.js";
import type { DragTarget, SourceRecord } from "../lib/ipc/contract.js";
import type { SourceDocument } from "../lib/domain/source-document.js";

const AUDIO_SCHEME = "fragments-audio";

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

/**
 * Answers a media request for a file on disk, honouring `Range`.
 *
 * Not `net.fetch(file://…)`, which is what this used to be: Electron's file
 * loader ignores the `Range` header Chromium sends and always replies `200` with
 * the whole body and no `Accept-Ranges`. Chromium reads that as an unseekable
 * resource — `audio.seekable` is `[0, 0]` and every `currentTime` assignment
 * snaps back to zero — so a fragment played the top of its whole recording
 * instead of its own slice. The browser preview never had the bug because the
 * dev server has always answered ranges, which is exactly the kind of drift
 * `lib/domain/audio-serving.ts` exists to stop.
 */
async function respondWithFile(filePath: string, request: Request): Promise<Response> {
  let size: number;
  try {
    size = (await fs.promises.stat(filePath)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const contentType = audioMimeType(filePath);
  const range = parseByteRange(request.headers.get("range") ?? undefined, size);

  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, size - 1);
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Content-Length": String(size === 0 ? 0 : end - start + 1),
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;

  // A HEAD asks what the resource is, not for its bytes; answering with a body
  // makes Chromium wait on a stream nothing will read.
  if (request.method === "HEAD" || size === 0) {
    return new Response(null, { status: range ? 206 : 200, headers });
  }

  const stream = Readable.toWeb(
    fs.createReadStream(filePath, { start, end }),
  ) as ReadableStream<Uint8Array>;
  return new Response(stream, { status: range ? 206 : 200, headers });
}

export function registerAudioScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: AUDIO_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }]);
}

export async function initializePersistence() {
  const libraryRoot = resolveLibraryRoot(app.getPath("documents"));
  const library = createLibraryService(libraryRoot);
  const audioUrl = (id: string) => `${AUDIO_SCHEME}://source/${encodeURIComponent(id)}`;

  /** Adds the custom-protocol audio URL the renderer needs but disk does not store. */
  const withAudioUrl = <T extends SourceDocument>(source: T): T & SourceRecord => ({
    ...source,
    audioUrl: audioUrl(source.id),
  });

  protocol.handle(AUDIO_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== "source") return new Response("Not found", { status: 404 });
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const source = (await library.listSources()).find((item) => item.id === id);
    if (!source) return new Response("Not found", { status: 404 });
    return respondWithFile(library.resolveAudioPath(id, source.audioFile), request);
  });

  // Handler args arrive over IPC as `unknown` by construction: a compromised or
  // buggy renderer can send anything. Each handler therefore asserts the shapes
  // it needs, and the library service validates again before writing.
  function logged(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: never[]) => unknown,
  ) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...(args as never[]));
      } catch (error) {
        console.error(`[fragments] ${channel} failed:`, error);
        throw error;
      }
    });
  }

  function assertId(value: unknown): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("source id must be a non-empty string");
    }
    return value;
  }

  /** The service rejects traversal too; this keeps the wrong type out first. */
  function assertFileName(value: unknown): string {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("file name must be a non-empty string");
    }
    return value;
  }

  function asBytes(value: unknown, label: string): Uint8Array {
    if (!(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) {
      throw new Error(`${label} payload must be binary`);
    }
    return value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  logged(FRAGMENTS_CHANNELS.pickAudio, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "m4a", "aif", "aiff", "flac", "ogg"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  logged(FRAGMENTS_CHANNELS.beginImport, async (_event, filePath: unknown) => {
    if (typeof filePath !== "string" || filePath.length === 0) {
      throw new Error("beginImport requires a file path");
    }
    return withAudioUrl(await library.beginImport(filePath));
  });
  logged(FRAGMENTS_CHANNELS.finalizeImport, async (_event, id: unknown, metadata: unknown) => (
    // The service validates `metadata` before writing anything.
    withAudioUrl(await library.finalizeImport(assertId(id), metadata as never))
  ));
  logged(FRAGMENTS_CHANNELS.cancelImport, (_event, id: unknown) => library.cancelImport(assertId(id)));
  logged(FRAGMENTS_CHANNELS.archiveSource, async (_event, id: unknown) => (
    withAudioUrl(await library.archiveSource(assertId(id)))
  ));
  logged(FRAGMENTS_CHANNELS.deleteSource, (_event, id: unknown) => library.deleteSource(assertId(id)));
  logged(FRAGMENTS_CHANNELS.listSources, async () => (
    (await library.listSources())
      .filter((source) => source.duration)
      .map(withAudioUrl)
  ));
  logged(FRAGMENTS_CHANNELS.updateSourceAnalysis, async (_event, id: unknown, analysis: unknown) => (
    withAudioUrl(await library.updateSourceAnalysis(assertId(id), analysis as never))
  ));
  logged(FRAGMENTS_CHANNELS.updateSourceSettings, async (_event, id: unknown, settings: unknown) => (
    withAudioUrl(await library.updateSourceSettings(assertId(id), settings as never))
  ));
  logged(FRAGMENTS_CHANNELS.updateFragments, async (_event, id: unknown, fragments: unknown) => (
    withAudioUrl(await library.updateFragments(assertId(id), fragments as never))
  ));
  logged(FRAGMENTS_CHANNELS.updateRelationships, async (_event, id: unknown, relationships: unknown) => (
    withAudioUrl(await library.updateRelationships(assertId(id), relationships as never))
  ));
  logged(FRAGMENTS_CHANNELS.readWaveform, async (_event, id: unknown) => {
    const bytes = await library.readWaveform(assertId(id));
    // A fresh copy, because a Buffer view over a pooled allocation would serialise
    // whatever else shares that pool.
    return bytes ? new Uint8Array(bytes).slice().buffer : null;
  });
  logged(FRAGMENTS_CHANNELS.writeWaveform, async (_event, id: unknown, bytes: unknown) => {
    await library.writeWaveform(assertId(id), asBytes(bytes, "waveform"));
  });
  logged(FRAGMENTS_CHANNELS.readRender, async (_event, id: unknown, fileName: unknown) => {
    const bytes = await library.readRender(assertId(id), assertFileName(fileName));
    return bytes ? new Uint8Array(bytes).slice().buffer : null;
  });
  logged(
    FRAGMENTS_CHANNELS.writeRender,
    async (_event, id: unknown, fileName: unknown, bytes: unknown) => {
      await library.writeRender(assertId(id), assertFileName(fileName), asBytes(bytes, "render"));
    },
  );

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
  async function stageForDrag(filePath: string, label: string) {
    const stagingDir = path.join(app.getPath("temp"), "fragments-drag-staging");
    await fs.promises.mkdir(stagingDir, { recursive: true });
    const extension = path.extname(filePath) || ".wav";
    const safeLabel = String(label || "audio").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "audio";
    const staged = path.join(stagingDir, `${safeLabel}${extension}`);
    await fs.promises.copyFile(filePath, staged);
    return staged;
  }

  ipcMain.on(FRAGMENTS_CHANNELS.startDrag, async (event, target: string | DragTarget | null) => {
    try {
      const sourceId = typeof target === "string" ? target : target?.sourceId;
      const assetPath = (typeof target === "object" ? target?.assetPath : null) ?? null;
      const renderFile = (typeof target === "object" ? target?.renderFile : null) ?? null;
      let filePath: string | null = null;
      if (sourceId && renderFile) {
        // A render is the fragment itself — sliced, and matched if that was asked
        // for — so it wins over the whole recording. Missing is normal: it may have
        // been pruned, or never written because this host cannot persist.
        const candidate = library.resolveRenderPath(sourceId, renderFile);
        if (await fs.promises.stat(candidate).then(() => true, () => false)) filePath = candidate;
      }
      if (!filePath && sourceId) {
        const source = (await library.listSources()).find((item) => item.id === sourceId);
        if (source) filePath = library.resolveAudioPath(sourceId, source.audioFile);
      }
      if (!filePath && assetPath) {
        filePath = resolveRendererPath(publicAssetsRoot, assetPath);
      }
      if (!filePath) return;
      const label = (typeof target === "object" ? target?.label : null)
        || sourceId
        || path.basename(assetPath || filePath, path.extname(filePath));
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
