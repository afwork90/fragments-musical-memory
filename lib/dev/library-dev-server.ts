// Serves the real managed library to the web build during `npm run dev`.
//
// The point is that the web and Electron builds read the *same* library folder,
// through the same `FragmentsBridge` contract, so the browser is a genuine
// preview rather than a parallel universe backed by a fake dataset. This module
// runs inside the Vite config (Node), and deliberately reuses
// `createLibraryService` — there is one implementation of persistence, with two
// transports in front of it.
//
// Read-only on purpose. The web bridge reports `persist: false`, so nothing here
// needs a write path.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Plugin } from "vite";

import { createLibraryService } from "../domain/library-service";
import { resolveLibraryRoot } from "../domain/paths";
import { WEB_LIBRARY_ROUTES } from "../ipc/contract";

const AUDIO_MIME: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
};

/**
 * Parses a single-range `Range: bytes=start-end` header. Seeking in an `<audio>`
 * element depends on this: Chrome asks for a range and treats a plain `200` with
 * the whole body as non-seekable, which makes scrubbing feel broken.
 */
function parseRange(header: string | undefined, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start < 0 || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

export function libraryDevServer(): Plugin {
  const libraryRoot = resolveLibraryRoot(path.join(homedir(), "Documents"));
  const library = createLibraryService(libraryRoot);

  return {
    name: "fragments-library-dev-server",
    apply: "serve",
    configureServer(server) {
      server.config.logger.info(`  fragments library: ${libraryRoot}`);

      server.middlewares.use(WEB_LIBRARY_ROUTES.sources, async (request, response) => {
        try {
          const sources = (await library.listSources()).filter((source) => source.duration);
          const payload = sources.map((source) => ({
            ...source,
            audioUrl: `${WEB_LIBRARY_ROUTES.audio}/${encodeURIComponent(source.id)}`,
          }));
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify(payload));
        } catch (error) {
          server.config.logger.error(`[fragments] listing the library failed: ${String(error)}`);
          response.statusCode = 500;
          response.end(JSON.stringify({ error: "could not read the library" }));
        }
      });

      server.middlewares.use(WEB_LIBRARY_ROUTES.waveform, async (request, response) => {
        // Vite strips the mount prefix, so `url` is `/<sourceId>`.
        const id = decodeURIComponent((request.url ?? "").replace(/^\/+/, "").split("?")[0]);
        if (!id) {
          response.statusCode = 400;
          response.end("missing source id");
          return;
        }

        try {
          const bytes = await library.readWaveform(id);
          if (!bytes) {
            response.statusCode = 404;
            response.end("no waveform");
            return;
          }
          response.setHeader("Content-Type", "application/octet-stream");
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Length", String(bytes.byteLength));
          response.end(Buffer.from(bytes));
        } catch (error) {
          server.config.logger.error(`[fragments] reading a waveform failed: ${String(error)}`);
          response.statusCode = 500;
          response.end("could not read the waveform");
        }
      });

      server.middlewares.use(WEB_LIBRARY_ROUTES.audio, async (request, response) => {
        // Vite strips the mount prefix, so `url` is `/<sourceId>`.
        const id = decodeURIComponent((request.url ?? "").replace(/^\/+/, "").split("?")[0]);
        if (!id) {
          response.statusCode = 400;
          response.end("missing source id");
          return;
        }

        try {
          const source = (await library.listSources()).find((item) => item.id === id);
          if (!source) {
            response.statusCode = 404;
            response.end("unknown source");
            return;
          }

          // resolveAudioPath rejects traversal, so `id` cannot escape the library.
          const filePath = library.resolveAudioPath(id, source.audioFile);
          const { size } = await stat(filePath);
          const contentType = AUDIO_MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
          const range = parseRange(request.headers.range, size);

          response.setHeader("Content-Type", contentType);
          response.setHeader("Accept-Ranges", "bytes");

          if (!range) {
            response.setHeader("Content-Length", String(size));
            createReadStream(filePath).pipe(response);
            return;
          }

          response.statusCode = 206;
          response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
          response.setHeader("Content-Length", String(range.end - range.start + 1));
          createReadStream(filePath, { start: range.start, end: range.end }).pipe(response);
        } catch (error) {
          server.config.logger.error(`[fragments] serving audio for ${id} failed: ${String(error)}`);
          response.statusCode = 500;
          response.end("could not read the audio file");
        }
      });
    },
  };
}
