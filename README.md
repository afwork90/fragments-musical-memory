# Fragments — Musical Memory

Prototype UI for exploring source recordings, fragmenting them, and browsing a musical library. The frontend runs on [vinext](https://github.com/cloudflare/vinext) (React 19 + Vite 8) and deploys as a Cloudflare Worker.

**Current state:** all domain data lives in the browser as demo fixtures under `app/`. There is no API, database, or auth yet. Audio decode and tempo/key analysis run entirely client-side.

## Prerequisites

- Node.js `>=22.13.0`

## Quick start

```bash
npm install
npm run dev      # local dev server
npm run build    # production build
npm run test     # build + smoke tests
npm run lint
```

## GitHub Pages

Pushes to the `gh-pages` branch build a static export and deploy it via GitHub Actions.

1. In the repository **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Push to `gh-pages` (or merge into it) to trigger `.github/workflows/deploy-gh-pages.yml`.
3. The site is published at `https://<user>.github.io/<repo>/` for project repositories.

The Pages build uses `npm run build:pages` (`output: "export"` with relative asset paths). Local `npm run build` still produces the full vinext worker bundle for Cloudflare-style hosting.

## Repository layout

Everything outside `app/` is shared infrastructure and client libraries. Backend work will mostly add APIs and bindings; the UI code under `app/` will eventually call those instead of `prototype-data.ts`.

```
fragments-musical-memory/
├── app/                 # React UI, routes, demo fixtures (prototype-data.ts)
├── lib/                 # Shared client code (no server secrets)
│   ├── audio/           # Decode, cache, Essentia BPM/key, waveform components
│   ├── ui/              # shadcn primitives (button, dialog, table)
│   ├── format.ts        # Display helpers (e.g. duration formatting)
│   └── utils.ts         # cn() and small utilities
├── public/              # Static assets served as-is
│   ├── audio/           # Demo WAV corpus for fragment playback
│   └── favicon.svg
├── worker/              # Cloudflare Worker entry (vinext app router)
├── tests/               # Rendered HTML + map layout smoke tests
├── vite.config.ts       # Vite + vinext + Cloudflare plugin
├── next.config.ts       # Required vinext stub (image config, etc.)
├── tsconfig.json
├── components.json      # shadcn CLI aliases (components live in lib/ui)
└── package.json
```

### `lib/audio/` — client audio pipeline

| Module | Role |
|--------|------|
| `audio-service.ts` | Decode uploaded files, build waveform peaks, in-memory cache, quick BPM/key on import |
| `audio-cache.ts` | LRU-style cache keyed by content hash |
| `essentia-loader.ts` | Lazy-load Essentia WASM |
| `essentia-analyze.ts` | BPM and key extraction |
| `use-audio-cache.ts` | React hooks to subscribe to cached audio |
| `waveform.tsx`, `continuous-waveform.tsx` | SVG waveform rendering |
| `types.ts` | Shared audio/analysis types |

Import flow today: user picks a file → `processAudioFile()` decodes in the browser → optional `quickAnalyzeCached()` runs Essentia on the loudest 20s window → results stored on the in-memory `SourceFile` object.

A future backend would likely own file storage, transcoding, and analysis jobs; the UI would fetch metadata and signed URLs instead of decoding locally.

### `worker/` — deployment entry

`worker/index.ts` is the Cloudflare Worker `fetch` handler vinext generates against. It proxies image optimization (`/_vinext/image`) and delegates everything else to the vinext app router.

No D1 or R2 bindings are configured (`d1` and `r2` are `null` in `vite.config.ts`). To add them later, set those variables and extend `worker/index.ts` / route handlers as needed.

### `public/`

Static files copied to the build output. The demo ships ~40 WAV files under `public/audio/` plus WebVTT captions. These are referenced by `app/prototype-data.ts`, not by any build step.

### `tests/`

- `rendered-html.test.mjs` — builds the app, renders `/` through the worker, asserts key UI strings and demo corpus counts.
- Imports `app/map-layout.mjs` for deterministic map camera math tests.

Tests encode some demo-specific copy (e.g. fragment names, “2,418 indexed”). Expect to relax those when real data replaces fixtures.

## Configuration notes

- **Path alias:** `@/` → repo root (`vite.config.ts`, `tsconfig.json`).
- **Essentia:** WASM is bundled via dynamic import; excluded from Vite pre-bundling (`optimizeDeps.exclude`).
- **Wrangler state:** logs and registry write under `.wrangler/` (gitignored).
- **No `wrangler.jsonc`:** bindings are declared inline in `vite.config.ts` for local Miniflare simulation.

## What backend integration will touch

Likely integration points (not implemented yet):

1. **Sources API** — upload, list, metadata (duration, BPM, key, waveform peaks).
2. **Fragments API** — CRUD on time ranges linked to sources.
3. **Library / search** — replace in-memory filtering in `app/page.tsx`.
4. **Auth** — none today; add when multi-user or private libraries are needed.
5. **Worker bindings** — enable `d1` / `r2` in `vite.config.ts` and wire persistence in `worker/`.

Until then, treat `app/prototype-data.ts` as the single source of truth for domain shapes and seed data.

## Learn more

- [vinext documentation](https://github.com/cloudflare/vinext)
