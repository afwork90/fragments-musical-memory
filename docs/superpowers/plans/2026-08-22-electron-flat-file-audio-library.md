# Electron Flat-File Audio Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the current Fragments UI as an Electron-only application whose imported audio and metadata persist in one managed directory per recording.

**Architecture:** Vinext continues to build the React renderer. Electron loads the development server during development and serves the static renderer through `app://` in production. A context-isolated preload bridge delegates all file operations to an Electron main-process storage service; each source directory contains copied audio and authoritative `source.json`.

**Tech Stack:** Electron, electron-builder, React 19, vinext/Vite, TypeScript, Node 22, Essentia.js, Node test runner.

## Global Constraints

- Electron is the only supported application target; remove GitHub Pages and Cloudflare deployment support.
- Keep the current visual application and navigation structure.
- Do not add a database, IndexedDB, cloud service, or unrestricted renderer filesystem access.
- Copy every import into `sources/<source-id>/original.<extension>`.
- Store authoritative metadata and fragments in `sources/<source-id>/source.json`.
- Store only relative paths in library JSON.
- Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`.
- Library fragments must be derived from source documents, never maintained as a competing catalog.
- Primary `f01.wav` through `f28.wav` become 28 sources with one whole-file fragment each.
- Derived stems and transformed audition files do not become sources.
- Do not migrate authored relationship scores or reasons as computed data.
- Use package-manager-selected current dependency versions; do not invent version pins.
- Do not commit during execution unless the user explicitly requests commits.

---

## Target File Map

### Electron process

- `electron/main.ts`: application lifecycle and secure `BrowserWindow`.
- `electron/preload.ts`: narrow context bridge.
- `electron/protocols/app-protocol.ts`: production renderer assets.
- `electron/protocols/audio-protocol.ts`: managed audio streaming.
- `electron/library/filesystem-library.ts`: flat-file library operations.
- `electron/library/atomic-write.ts`: durable JSON replacement.
- `electron/library/path-guard.ts`: source ID and containment checks.
- `electron/library/settings.ts`: selected library pointer in Electron user data.
- `electron/ipc/handlers.ts`: validated IPC handlers.
- `electron/tsconfig.json`: NodeNext Electron compilation.

### Shared renderer/domain

- `lib/domain/library.ts`: persistent source/fragment schema.
- `lib/domain/views.ts`: conversion to existing UI models.
- `lib/domain/types.ts`: UI-facing musical and matching types.
- `lib/storage/library-storage.ts`: renderer storage interface.
- `lib/storage/electron-library-storage.ts`: preload-backed adapter.
- `lib/storage/use-library.ts`: load/refresh/save hook.
- `shared/ipc.ts`: serializable bridge contracts.
- `types/fragments-bridge.d.ts`: typed `window.fragments`.

### Migration/tests

- `resources/seed-library.json`: labels and filenames for 28 primary WAVs.
- `electron/library/seed-library.ts`: one-time copy into a new library.
- `tests/library-schema.test.mjs`: schema/range tests.
- `tests/filesystem-library.test.mjs`: real temp-directory persistence tests.
- `tests/electron-protocols.test.mjs`: path/protocol normalization tests.
- `tests/library-consistency.test.mjs`: source/fragment reconciliation tests.

---

### Task 1: Convert the build into an Electron-only shell

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`
- Modify: `next.config.ts`
- Modify: `.gitignore`
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `electron/protocols/app-protocol.ts`
- Create: `electron/tsconfig.json`
- Delete: `.github/workflows/deploy-gh-pages.yml`
- Delete: `worker/index.ts`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces: `appUrl(): string`, `registerAppScheme(): void`, `registerAppProtocol(): void`.
- Produces: compiled entry `electron-dist/electron/main.js`.

- [ ] **Step 1: Change rendered HTML smoke testing to the static renderer**

Replace the worker-backed `render()` in `tests/rendered-html.test.mjs`:

```js
async function render() {
  const html = await readFile(
    new URL("../dist/client/index.html", import.meta.url),
    "utf8",
  );
  return {
    status: 200,
    headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    text: async () => html,
  };
}
```

Remove assertions tied to `prototype-data.ts`, Cloudflare worker output, and GitHub Pages. Keep current UI-shell assertions.

- [ ] **Step 2: Run the renderer test and confirm the old build contract fails**

Run:

```bash
npm run build && node --test tests/rendered-html.test.mjs
```

Expected: FAIL because the current build does not always emit the Electron static-export contract and tests still depend on removed deployment behavior.

- [ ] **Step 3: Install Electron tooling and remove Cloudflare tooling**

Run:

```bash
npm install --save-dev electron electron-builder concurrently wait-on cross-env
npm uninstall @cloudflare/vite-plugin wrangler
```

Update `package.json`:

```json
{
  "main": "electron-dist/electron/main.js",
  "scripts": {
    "dev": "concurrently -k \"npm:dev:renderer\" \"npm:dev:electron\"",
    "dev:renderer": "vinext dev --port 3000",
    "dev:electron": "npm run build:electron && wait-on http://localhost:3000 && cross-env ELECTRON_RENDERER_URL=http://localhost:3000 electron .",
    "build:renderer": "vinext build",
    "build:electron": "tsc -p electron/tsconfig.json",
    "build": "npm run build:renderer && npm run build:electron",
    "test": "npm run build && node --test tests/*.test.mjs",
    "pack": "npm run build && electron-builder --dir",
    "dist": "npm run build && electron-builder"
  },
  "build": {
    "appId": "com.fragments.musical-memory",
    "productName": "Fragments",
    "directories": { "output": "release" },
    "files": [
      "electron-dist/**",
      "dist/client/**",
      "package.json"
    ],
    "extraResources": [
      {
        "from": "public/audio",
        "to": "seed-audio",
        "filter": ["f??.wav"]
      },
      {
        "from": "resources",
        "to": "resources"
      }
    ],
    "mac": {
      "category": "public.app-category.music",
      "target": ["dmg", "zip"]
    }
  }
}
```

- [ ] **Step 4: Make vinext always emit the packaged static renderer**

Set `next.config.ts` to:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
```

Set `vite.config.ts` to:

```ts
import path from "node:path";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: ["essentia.js"],
  },
  plugins: [vinext()],
});
```

Remove the Pages workflow and `worker/index.ts`. Add `electron-dist/` and `release/` to `.gitignore`.

- [ ] **Step 5: Add the secure production renderer protocol**

Create `electron/protocols/app-protocol.ts`:

```ts
import { app, net, protocol } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const APP_SCHEME = "app";

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function resolveRendererPath(root: string, pathname: string): string | null {
  const relative = decodeURIComponent(pathname)
    .replace(/^\/\.\//, "/")
    .replace(/^\/+/, "") || "index.html";
  const resolved = path.resolve(root, relative);
  const prefix = `${path.resolve(root)}${path.sep}`;
  return resolved === path.resolve(root) || resolved.startsWith(prefix)
    ? resolved
    : null;
}

export function registerAppProtocol(): void {
  const root = path.join(app.getAppPath(), "dist", "client");
  protocol.handle(APP_SCHEME, (request) => {
    const pathname = new URL(request.url).pathname;
    const resolved = resolveRendererPath(root, pathname);
    if (!resolved) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(resolved).href);
  });
}

export function appUrl(): string {
  return `${APP_SCHEME}://./index.html`;
}
```

- [ ] **Step 6: Add the initial main process and empty preload**

Create `electron/preload.ts`:

```ts
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("fragments", {});
```

Create `electron/main.ts`:

```ts
import { app, BrowserWindow } from "electron";
import path from "node:path";
import {
  appUrl,
  registerAppProtocol,
  registerAppScheme,
} from "./protocols/app-protocol.js";

registerAppScheme();

const developmentUrl = process.env.ELECTRON_RENDERER_URL;

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      preload: path.join(app.getAppPath(), "electron-dist", "electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== developmentUrl && !url.startsWith("app://")) event.preventDefault();
  });

  await window.loadURL(developmentUrl ?? appUrl());
}

app.whenReady().then(async () => {
  if (!developmentUrl) registerAppProtocol();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

Create `electron/tsconfig.json`:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022"],
    "rootDir": "..",
    "outDir": "../electron-dist",
    "noEmit": false
  },
  "include": [
    "./**/*.ts",
    "../shared/**/*.ts",
    "../lib/domain/**/*.ts"
  ]
}
```

- [ ] **Step 7: Verify the unchanged UI in Electron**

Run:

```bash
npm run dev
```

Expected: Electron opens the same Library/Sources/Map application at `1440×900`; renderer HMR works.

Run:

```bash
npm run build
node --test tests/rendered-html.test.mjs
npm run pack
```

Expected: all commands pass and `release/` contains an unpacked Electron application.

- [ ] **Step 8: Review checkpoint**

Review the shell conversion diff. Commit only if the user explicitly requests it.

---

### Task 2: Define the persistent library schema and view adapters

**Files:**
- Create: `lib/domain/library.ts`
- Create: `lib/domain/types.ts`
- Create: `lib/domain/views.ts`
- Create: `tests/library-schema.test.mjs`
- Modify: type imports throughout `app/`

**Interfaces:**
- Produces: `SourceDocument`, `FragmentDocument`, `LibraryIndex`.
- Produces: `validateSourceDocument(value: unknown): SourceDocument`.
- Produces: `sourceToView(source, audioUrl): SourceFile` and `fragmentsToViews(source, audioUrl): Fragment[]`.

- [ ] **Step 1: Write schema tests**

Create tests covering:

```js
test("accepts a source with one valid whole-file fragment", () => {
  const source = validSource({ duration: 12, start: 0, end: 12 });
  assert.equal(validateSourceDocument(source).fragments.length, 1);
});

test("rejects a fragment outside source duration", () => {
  const source = validSource({ duration: 12, start: 4, end: 13 });
  assert.throws(() => validateSourceDocument(source), /fragment range/i);
});

test("rejects absolute audio paths", () => {
  const source = validSource({ audioFile: "/tmp/example.wav" });
  assert.throws(() => validateSourceDocument(source), /relative audio filename/i);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run build:electron && node --test tests/library-schema.test.mjs
```

Expected: FAIL because the schema module does not exist.

- [ ] **Step 3: Implement persisted types and validation**

Define in `lib/domain/library.ts`:

```ts
export type MusicalRole =
  | "Melody"
  | "Rhythm"
  | "Harmony"
  | "Bass"
  | "Voice"
  | "Texture"
  | "Unclassified";

export type SourceType =
  | "Voice memo"
  | "Jam"
  | "Practice"
  | "Studio"
  | "Field recording"
  | "Archive";

export type MeasuredAnalysis = {
  bpm: number | null;
  key: string | null;
  scale: string | null;
  keyStrength: number | null;
};

export type FragmentDocument = {
  id: string;
  name: string;
  start: number;
  end: number;
  roles: MusicalRole[];
  primaryRole: MusicalRole;
  userTags: string[];
  analysis: MeasuredAnalysis;
  analysisRevision: number;
};

export type SourceDocument = {
  schemaVersion: 1;
  id: string;
  originalName: string;
  audioFile: string;
  contentHash: string;
  importedAt: string;
  recordedAt: string | null;
  duration: number;
  format: string;
  sampleRate: number;
  waveform: { version: 1; count: number; peaks: number[] };
  analysis: MeasuredAnalysis;
  sourceTypes: SourceType[];
  analysisProfile: string;
  sensitivity: number;
  fragments: FragmentDocument[];
  unavailable?: boolean;
};

export type LibraryIndex = {
  schemaVersion: 1;
  libraryId: string;
  name: string;
  updatedAt: string;
  sources: { id: string; path: string }[];
};
```

Implement explicit runtime checks for schema version, IDs, relative `audioFile`, finite duration, peak values, and `0 <= start < end <= duration`.

- [ ] **Step 4: Extract UI-facing types without changing component markup**

Move `Fragment`, `SourceFile`, matching types, profiles, and filter types from `app/prototype-data.ts` to `lib/domain/types.ts`. Make measured-only fields nullable where analysis does not provide them. Update cells to render `—` for null bars, beats, confidence, role, brightness, BPM, and key.

Implement `lib/domain/views.ts` so the rest of the UI receives the existing `SourceFile` and `Fragment` shapes from one `SourceDocument`.

- [ ] **Step 5: Run tests and lint**

Run:

```bash
npm run build
node --test tests/library-schema.test.mjs
npm run lint
```

Expected: schema tests pass; existing UI still builds with no new lint errors.

- [ ] **Step 6: Review checkpoint**

Review domain boundaries. Commit only if explicitly requested.

---

### Task 3: Implement atomic filesystem storage

**Files:**
- Create: `electron/library/atomic-write.ts`
- Create: `electron/library/path-guard.ts`
- Create: `electron/library/filesystem-library.ts`
- Create: `electron/library/settings.ts`
- Create: `tests/filesystem-library.test.mjs`

**Interfaces:**
- Produces: `FilesystemLibrary`.
- Consumes: `SourceDocument`, `LibraryIndex`, `validateSourceDocument`.
- Produces methods:

```ts
open(root: string): Promise<LibraryIndex>;
listSources(): Promise<SourceDocument[]>;
listPendingImports(): Promise<PendingImportRecord[]>;
beginImport(sourcePath: string): Promise<PendingImportRecord>;
finalizeImport(id: string, source: SourceDocument): Promise<SourceDocument>;
cancelImport(id: string): Promise<void>;
saveSource(source: SourceDocument): Promise<SourceDocument>;
rebuildIndex(): Promise<LibraryIndex>;
resolveAudioPath(id: string): Promise<string | null>;
```

Define the storage-only record in `filesystem-library.ts`:

```ts
export type PendingImportRecord = {
  id: string;
  originalName: string;
  audioFile: string;
  contentHash: string;
  duplicateOf: string | null;
};
```

- [ ] **Step 1: Write temp-directory filesystem tests**

Cover initialization, copy, SHA-256 deduplication, atomic source save, range validation, index rebuild, missing audio, corrupt JSON quarantine, and traversal rejection.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run build:electron && node --test tests/filesystem-library.test.mjs
```

Expected: FAIL because `FilesystemLibrary` does not exist.

- [ ] **Step 3: Implement atomic JSON writes**

Create `electron/library/atomic-write.ts`:

```ts
import { open, rename, rm } from "node:fs/promises";

export async function atomicWriteJson(pathname: string, value: unknown): Promise<void> {
  const temporary = `${pathname}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, pathname);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
```

- [ ] **Step 4: Implement path containment**

Accept IDs matching `/^src_[0-9a-f-]{36}$/`. Resolve every path under the selected library root and reject any path that does not begin with `${resolvedRoot}${path.sep}`. JSON stores `sources/<id>/source.json` and `original.<extension>`, never absolute paths.

- [ ] **Step 5: Implement `FilesystemLibrary`**

Use `crypto.randomUUID()`, streaming SHA-256, `fs.copyFile`, `.imports/<id>/`, and final atomic directory rename. The root index is rebuilt by scanning `sources/*/source.json`; malformed files move to `quarantine/<timestamp>-<source-id>-source.json`.

Store the chosen library root in Electron’s user data as:

```json
{
  "schemaVersion": 1,
  "libraryRoot": "/absolute/user-selected/path"
}
```

This settings file is Electron-local configuration; library documents themselves remain portable and relative.

- [ ] **Step 6: Run persistence tests**

Run:

```bash
npm run build:electron
node --test tests/filesystem-library.test.mjs
```

Expected: all storage tests pass.

- [ ] **Step 7: Review checkpoint**

Review filesystem safety and recovery. Commit only if explicitly requested.

---

### Task 4: Add secure IPC, preload, and managed audio protocol

**Files:**
- Create: `shared/ipc.ts`
- Create: `electron/ipc/handlers.ts`
- Create: `electron/protocols/audio-protocol.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Create: `types/fragments-bridge.d.ts`
- Create: `tests/electron-protocols.test.mjs`

**Interfaces:**
- Produces `window.fragments` methods:

```ts
export type PendingImport = {
  id: string;
  originalName: string;
  audioFile: string;
  audioUrl: string;
  contentHash: string;
  duplicateOf: string | null;
};

chooseLibrary(): Promise<LibraryDescriptor | null>;
openLibrary(): Promise<LibraryDescriptor>;
listSources(): Promise<SourceDocument[]>;
listPendingImports(): Promise<PendingImport[]>;
pickAudioFile(): Promise<string | null>;
beginImport(sourcePath: string): Promise<PendingImport>;
finalizeImport(id: string, source: SourceDocument): Promise<SourceDocument>;
cancelImport(id: string): Promise<void>;
saveSource(source: SourceDocument): Promise<SourceDocument>;
getAudioUrl(sourceId: string): Promise<string>;
rebuildIndex(): Promise<LibraryIndex>;
```

- [ ] **Step 1: Write protocol/path tests**

Verify renderer traversal is rejected and `fragments-audio://source/src_<uuid>` resolves only through the active library’s source index.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run build:electron && node --test tests/electron-protocols.test.mjs
```

Expected: FAIL because the audio protocol helpers do not exist.

- [ ] **Step 3: Define serializable IPC contracts**

Use constant channel names in `shared/ipc.ts`; prohibit generic channel invocation. Validate every object again in the main process before storage operations.

- [ ] **Step 4: Implement managed audio streaming**

Register `fragments-audio` as a privileged standard/secure/fetch/stream scheme before `app.whenReady()`. Handle URLs shaped as:

```text
fragments-audio://source/src_123e4567-e89b-12d3-a456-426614174000
```

Require `url.host === "source"`, decode the ID from `url.pathname`, resolve it through `FilesystemLibrary.resolveAudioPath()`, and stream with `net.fetch(pathToFileURL(path).href)`. Never accept a renderer-provided path.

- [ ] **Step 5: Implement preload and handlers**

Expose individual `ipcRenderer.invoke()` wrappers through `contextBridge`. Use Electron’s native open dialog for library folders and audio files. Return structured errors:

```ts
type LibraryErrorCode =
  | "NO_LIBRARY"
  | "DUPLICATE_AUDIO"
  | "INVALID_SOURCE"
  | "MISSING_AUDIO"
  | "UNSUPPORTED_SCHEMA"
  | "FILESYSTEM_ERROR";
```

- [ ] **Step 6: Wire Electron startup**

At startup, open the saved library or create/select one. Register handlers and protocols before creating the window. The renderer sees no raw filesystem APIs.

- [ ] **Step 7: Verify**

Run:

```bash
npm run build
node --test tests/electron-protocols.test.mjs tests/filesystem-library.test.mjs
npm run dev
```

Expected: tests pass; DevTools shows `window.fragments`; fetching a managed audio URL returns audio bytes.

- [ ] **Step 8: Review checkpoint**

Review bridge security. Commit only if explicitly requested.

---

### Task 5: Load one storage-backed model into Library and Sources

**Files:**
- Create: `lib/storage/library-storage.ts`
- Create: `lib/storage/electron-library-storage.ts`
- Create: `lib/storage/use-library.ts`
- Modify: `app/fragments-app.tsx`
- Modify: `app/features/sources/sources-view.tsx`
- Modify: `app/features/sources/sources-toolbar.tsx`
- Modify: `app/features/sources/import-dialog.tsx`
- Create: `tests/library-consistency.test.mjs`

**Interfaces:**
- Produces:

```ts
export interface LibraryStorage {
  listSources(): Promise<SourceDocument[]>;
  getAudioUrl(sourceId: string): Promise<string>;
  listPendingImports(): Promise<PendingImport[]>;
  beginImport(sourcePath: string): Promise<PendingImport>;
  finalizeImport(id: string, source: SourceDocument): Promise<SourceDocument>;
  cancelImport(id: string): Promise<void>;
  saveSource(source: SourceDocument): Promise<SourceDocument>;
}
```

- Produces:

```ts
useLibrary(): {
  sourceDocuments: SourceDocument[];
  sources: SourceFile[];
  fragments: Fragment[];
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  saveSource(source: SourceDocument): Promise<void>;
};
```

- [ ] **Step 1: Write consistency tests**

Assert:

```js
assert.equal(
  fragments.length,
  sources.reduce((count, source) => count + source.fragments.length, 0),
);
for (const fragment of fragments) {
  assert.ok(sources.some((source) => source.id === fragment.sourceId));
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run build && node --test tests/library-consistency.test.mjs
```

Expected: FAIL because the app still maintains prototype source and fragment catalogs separately.

- [ ] **Step 3: Implement the renderer adapter and hook**

`ElectronLibraryStorage` delegates only to `window.fragments`. `useLibrary` loads source documents once, resolves one audio URL per source, creates Source and Fragment views, and exposes refresh/save.

- [ ] **Step 4: Replace prototype state in `fragments-app.tsx`**

Replace initial `SOURCE_FILES`, `FRAGMENTS`, `sourceRanges`, `fragmentOverrides`, and `importComplete` sources of truth with `useLibrary()`. Derive ranges from persisted fragments:

```ts
const sourceRanges = useMemo(
  () => Object.fromEntries(
    sourceDocuments.map((source) => [
      source.id,
      source.fragments.map((fragment, index) => ({
        id: `${fragment.id}-range`,
        fragmentId: fragment.id,
        start: fragment.start,
        end: fragment.end,
        color: RANGE_COLORS[index % RANGE_COLORS.length],
      })),
    ]),
  ),
  [sourceDocuments],
);
```

Remove staged import gating and make the top-bar count derive from actual fragment/source counts.

- [ ] **Step 5: Remove staged import props**

Remove `importComplete` from `SourcesView` and `SourcesToolbar`. The Import button always displays `＋ Import`.

- [ ] **Step 6: Keep relationship UI honest**

Set production relationships to an empty typed array. Keep Connections, Map, and Combine component shells, but show existing empty states and no fabricated scores/edges. Remove hard-coded `r01`, “Rediscovered,” and fake correction recomputation branches.

- [ ] **Step 7: Verify**

Run:

```bash
npm run build
npm test
npm run lint
```

Expected: Library and Sources derive from the same source documents; all UI routes render; links show honest empty states.

- [ ] **Step 8: Review checkpoint**

Compare the Electron UI against the current app at the same viewport. Commit only if explicitly requested.

---

### Task 6: Make import persistent

**Files:**
- Modify: `app/features/sources/import-dialog.tsx`
- Modify: `lib/audio/audio-service.ts`
- Modify: `lib/storage/use-library.ts`
- Modify: `app/fragments-app.tsx`
- Modify: `tests/filesystem-library.test.mjs`

**Interfaces:**
- Consumes: `beginImport`, `finalizeImport`, `cancelImport`.
- Produces one `SourceDocument` with one whole-file `FragmentDocument`.

- [ ] **Step 1: Add an import round-trip test**

Use a temporary library and a tiny WAV fixture. Assert the import creates:

```text
sources/<source-id>/original.wav
sources/<source-id>/source.json
```

Reload `FilesystemLibrary` and assert the source and fragment remain.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
npm run build:electron && node --test tests/filesystem-library.test.mjs
```

Expected: FAIL until renderer-completed metadata can finalize an import.

- [ ] **Step 3: Change the import dialog to native file selection**

Call `pickAudioFile()` and `beginImport(path)`. Decode `pending.audioUrl` with a new `processAudioUrl(url, name, options)` helper that fetches bytes and delegates to `processAudioBuffer`.

- [ ] **Step 4: Build the authoritative source document**

Use measured `ProcessedAudio` fields. Generate one fragment spanning `0` through `duration`, with role `Unclassified`, empty tags, and the measured BPM/key analysis. Use the original filename as both source and initial fragment display name.

- [ ] **Step 5: Finalize or cancel atomically**

On success, call `finalizeImport()` then `refresh()`. On dialog cancellation or decode failure, call `cancelImport()`. Duplicate content presents “Open existing” and “Import another copy”; it does not silently duplicate.

- [ ] **Step 6: Verify persistence manually**

Run:

```bash
npm run dev
```

Import a WAV, close Electron, restart `npm run dev`, and verify:

- the source remains in Sources
- its whole-file fragment remains in Library
- waveform, BPM, and key remain
- playback uses the copied managed file
- moving/deleting the original selected file does not break playback

- [ ] **Step 7: Review checkpoint**

Review import lifecycle and duplicate behavior. Commit only if explicitly requested.

---

### Task 7: Persist fragmentation edits

**Files:**
- Modify: `app/fragments-app.tsx`
- Modify: `app/fragmentation-workbench.tsx`
- Modify: `lib/storage/use-library.ts`
- Modify: `tests/library-consistency.test.mjs`

**Interfaces:**
- Consumes: `saveSource(source: SourceDocument)`.
- Produces persisted fragment add/update operations.

- [ ] **Step 1: Write fragmentation persistence tests**

Start with one whole-file fragment, save two non-overlapping ranges, reload storage, and assert Library exposes exactly two fragments with the saved boundaries.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run build && node --test tests/library-consistency.test.mjs
```

Expected: FAIL because current edits live only in React state.

- [ ] **Step 3: Map workbench ranges into source fragments**

On Save, preserve IDs for existing fragments and generate `frag_${crypto.randomUUID()}` for new ranges. Update names, start/end, revision, and measured analysis without mutating unrelated source metadata.

- [ ] **Step 4: Save through storage**

Replace `fragmentOverrides` and session-only boundary writes with `saveSource(updatedSource)`, then refresh Library/Sources from disk. Sensitivity is persisted in the same `source.json`.

- [ ] **Step 5: Make playback honor fragment boundaries**

Use the managed source audio URL. Set `audio.currentTime = fragment.start`; stop or loop when `timeupdate` reaches `fragment.end`. Do not create clipped files.

- [ ] **Step 6: Verify**

Run:

```bash
npm test
npm run lint
```

Restart Electron after editing boundaries. Expected: edited fragments and sensitivity survive and both tabs agree.

- [ ] **Step 7: Review checkpoint**

Review persistence and playback boundary behavior. Commit only if explicitly requested.

---

### Task 8: Seed the 28 real WAV files and retire prototype data

**Files:**
- Create: `resources/seed-library.json`
- Create: `electron/library/seed-library.ts`
- Modify: `electron/library/filesystem-library.ts`
- Modify: `app/fragments-app.tsx`
- Modify: all former `prototype-data.ts` importers
- Delete: `app/prototype-data.ts`
- Modify: `tests/library-consistency.test.mjs`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces: `seedLibraryIfEmpty(root, resourcesPath): Promise<void>`.

- [ ] **Step 1: Create a seed manifest**

List exactly `f01.wav` through `f28.wav`, retaining their existing display names only. Exclude every stem, transformed, matched, and caption file.

- [ ] **Step 2: Write migration tests**

Assert seeding creates 28 source directories, 28 source JSON files, 28 primary audio copies, and 28 whole-file fragments. Assert every fragment resolves to its parent source.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm run build && node --test tests/library-consistency.test.mjs
```

Expected: FAIL because seed migration does not exist.

- [ ] **Step 4: Implement first-run seeding**

When a newly created library has no sources, copy packaged primary WAVs through the same `beginImport()` path. Leave each unfinished source under `.imports/<source-id>` and expose it through `listPendingImports()`. The renderer processes pending imports sequentially, saves measured duration, sample rate, peaks, BPM, key, and confidence through `finalizeImport()`, then advances to the next item. On restart, `listPendingImports()` returns only unfinished directories, so migration resumes without duplicating completed sources.

- [ ] **Step 5: Remove prototype fixtures from runtime**

Move remaining reusable types/default profiles into `lib/domain/`. Delete staged IDs, synthetic waves, source aggregation, fake relationships, and `app/prototype-data.ts`.

- [ ] **Step 6: Update assertions**

Replace “24 surfaced · 2,418 indexed” and source-code regex tests with:

- 28 seed source documents
- 28 resolvable initial fragments
- no imported derived audition assets
- measured waveform arrays
- actual audio files present in each managed source directory

- [ ] **Step 7: Verify**

Run:

```bash
npm test
npm run lint
npm run pack
```

Expected: all checks pass; a clean Electron user-data directory initializes the real 28-file library.

- [ ] **Step 8: Review checkpoint**

Review migration output and UI parity. Commit only if explicitly requested.

---

### Task 9: Finish packaging, documentation, and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-08-22-electron-flat-file-audio-library-design.md`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces installable macOS `.dmg` and `.zip` artifacts in `release/`.

- [ ] **Step 1: Document the desktop workflow**

Document:

```bash
npm install
npm run dev
npm test
npm run pack
npm run dist
```

Explain the selected library folder, one-source-per-directory structure, JSON recovery, and the fact that the app is not a web deployment.

- [ ] **Step 2: Run the complete automated suite**

Run:

```bash
npm test
npm run lint
npm run pack
```

Expected: all tests pass, lint has no new errors, and packaging succeeds.

- [ ] **Step 3: Run the desktop acceptance test**

Using the packaged application:

1. Create a fresh library.
2. Confirm 28 seed sources and fragments load.
3. Navigate Library, Sources, Map, filters, side panels, and fragmentation.
4. Import an additional audio file.
5. Confirm one copied audio file and `source.json` exist under its source directory.
6. Quit and reopen.
7. Confirm playback, waveform, metadata, and fragments persist.
8. Move the original external file and confirm managed playback still works.
9. Corrupt a copied test `source.json` and confirm quarantine/report behavior.
10. Delete `library.json` and confirm index rebuild recovers sources.

- [ ] **Step 4: Inspect the package**

Confirm the packaged application contains:

- `dist/client/**`
- `electron-dist/**`
- seed manifest and only `f01.wav` through `f28.wav` as seed audio

Confirm it does not contain:

- Cloudflare worker runtime
- GitHub Pages workflow/output
- D1/R2 bindings
- a database

- [ ] **Step 5: Final review checkpoint**

Report changed files, tests, package artifact path, and any pre-existing warnings. Commit only if explicitly requested.
