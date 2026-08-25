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

import { audioMimeType, parseByteRange } from "../domain/audio-serving";
import { createLibraryService } from "../domain/library-service";
import { resolveLibraryRoot } from "../domain/paths";
import { WEB_LIBRARY_ROUTES } from "../ipc/contract";

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

      server.middlewares.use(WEB_LIBRARY_ROUTES.render, async (request, response) => {
        // Vite strips the mount prefix, so `url` is `/<sourceId>/<fileName>`.
        const [rawId, rawFile] = (request.url ?? "").replace(/^\/+/, "").split("?")[0].split("/");
        const id = decodeURIComponent(rawId ?? "");
        const fileName = decodeURIComponent(rawFile ?? "");
        if (!id || !fileName) {
          response.statusCode = 400;
          response.end("missing source id or render name");
          return;
        }

        try {
          const bytes = await library.readRender(id, fileName);
          if (!bytes) {
            response.statusCode = 404;
            response.end("no render");
            return;
          }
          response.setHeader("Content-Type", "audio/wav");
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Length", String(bytes.byteLength));
          response.end(Buffer.from(bytes));
        } catch (error) {
          server.config.logger.error(`[fragments] reading a render failed: ${String(error)}`);
          response.statusCode = 500;
          response.end("could not read the render");
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
          const range = parseByteRange(request.headers.range, size);

          response.setHeader("Content-Type", audioMimeType(filePath));
          response.setHeader("Accept-Ranges", "bytes");

          if (range === "unsatisfiable") {
            response.statusCode = 416;
            response.setHeader("Content-Range", `bytes */${size}`);
            response.end();
            return;
          }

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
