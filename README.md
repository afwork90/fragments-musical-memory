# Fragments — Musical Memory

Desktop app (Electron) for browsing source recordings, fragmenting them, and combining fragments into a musical library. Imported audio is copied into a flat-file library on disk (no database) so it persists across restarts. The same UI also runs as a plain web page in a browser, but only the Electron app persists imports and supports dragging audio out to the desktop/DAW.

## Prerequisites

- Node.js `>=22.13.0`

## Quick start

```bash
npm install
npm run dev             # browser-only dev server (no persistence), http://localhost:3000
```

Other useful scripts:

```bash
npm run dev:electron    # launch Electron against an already-running dev server (needs `npm run dev` in another terminal)
npm run dev:all         # renderer (Vite) + Electron together in one command, with hot reload
npm run start:electron  # full build, then launch Electron once (no hot reload)
npm run build           # build renderer + electron main process
npm run test            # build + smoke tests
npm run lint
```

## Local library

When running in Electron, imported audio files are copied into `~/Documents/Fragments Library/sources/<id>/`, each with the original audio file plus a `source.json` of metadata (duration, waveform peaks, BPM/key if analyzed). Override the location with the `FRAGMENTS_LIBRARY_ROOT` env var. In plain-browser mode there's no Electron bridge, so imports only live in memory for that tab.

## Building installers

```bash
npm run dist:mac    # macOS dmg + zip, under release/
npm run dist:win    # Windows nsis installer + zip, under release/
```

`dist:win` can be run from macOS — electron-builder downloads its own bundled Wine automatically to build the Windows installer, no manual Wine install needed. On Apple Silicon, make sure Rosetta is installed (`softwareupdate --install-rosetta`) since the bundled Wine build runs under it. The resulting Windows build isn't code-signed.

## Repository layout

```
fragments-musical-memory/
├── app/                 # React UI, routes, demo fixtures (prototype-data.ts)
├── electron/            # Electron main process, preload, persistence IPC, custom protocols
├── lib/
│   ├── audio/           # Decode, cache, Essentia BPM/key, waveform components, desktop drag-out
│   ├── domain/          # library-service.mjs — flat-file library persistence core
│   ├── ui/              # shadcn primitives (button, dialog, table)
│   └── format.ts, utils.ts
├── scripts/             # seed-library.mjs and other one-off maintenance scripts
├── public/audio/        # Demo WAV corpus
├── tests/               # Smoke tests (rendered HTML, library service, app protocol)
├── vite.config.ts       # Vite + vinext plugin
└── package.json
```

## Learn more

- [vinext documentation](https://github.com/cloudflare/vinext)
- [Electron native file drag & drop](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop)
