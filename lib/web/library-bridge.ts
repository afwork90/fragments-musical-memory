// A `FragmentsBridge` for the browser, backed by the dev server in
// `lib/dev/library-dev-server.ts` rather than Electron IPC.
//
// Renderer-only: this uses `fetch` and must not be compiled into the Electron
// main process, so it lives outside `lib/ipc/`.
//
// It can read the real library and nothing else. Every mutation rejects with a
// message worth showing a user, and `capabilities` advertises that up front so
// callers disable the affordance instead of discovering it by failing.

import { WEB_LIBRARY_ROUTES } from "../ipc/contract";
import type { BeginImportResult, FragmentsBridge, SourceRecord } from "../ipc/contract";
import { normalizeSourceDocument } from "../domain/source-document";

const WEB_PREVIEW_MESSAGE =
  "The web preview reads your library but cannot change it. Use the desktop app.";

function unsupported(): never {
  throw new Error(WEB_PREVIEW_MESSAGE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The response crosses an untrusted boundary exactly like IPC does, so it gets
 * the same treatment: take `unknown`, run it through the domain's normalizer, and
 * keep the `audioUrl` the server minted.
 */
function toSourceRecords(payload: unknown): SourceRecord[] {
  if (!Array.isArray(payload)) throw new Error("library index was not an array");
  return payload.map((entry) => {
    const document = normalizeSourceDocument(entry);
    const audioUrl = isRecord(entry) && typeof entry.audioUrl === "string" ? entry.audioUrl : "";
    return { ...document, audioUrl };
  });
}

export function createWebLibraryBridge(): FragmentsBridge {
  return {
    capabilities: { import: false, persist: false, drag: false },

    async listSources() {
      const response = await fetch(WEB_LIBRARY_ROUTES.sources, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`library index request failed with ${response.status}`);
      return toSourceRecords(await response.json());
    },

    // Returning null makes the import dialog fall back to its in-browser file
    // input, which decodes a file for preview without persisting it.
    async pickAudioFile() {
      return null;
    },

    async beginImport(): Promise<BeginImportResult> {
      return unsupported();
    },
    async finalizeImport(): Promise<SourceRecord> {
      return unsupported();
    },
    async cancelImport(): Promise<void> {
      return unsupported();
    },
    async archiveSource(): Promise<SourceRecord> {
      return unsupported();
    },
    async updateSourceAnalysis(): Promise<SourceRecord> {
      return unsupported();
    },
    async updateSourceSettings(): Promise<SourceRecord> {
      return unsupported();
    },
    async updateFragments(): Promise<SourceRecord> {
      return unsupported();
    },
    async updateRelationships(): Promise<SourceRecord> {
      return unsupported();
    },

    startDrag() {
      // A browser cannot hand a real file to another application. Callers check
      // `capabilities.drag` first; this stays silent so a stray call is harmless.
    },
  };
}
