// The preload script exposes the Electron bridge on `window.fragments`. It is
// absent when the renderer runs in a plain browser, so it is optional — check
// before calling rather than casting.

import type { FragmentsBridge } from "../lib/ipc/contract";

declare global {
  interface Window {
    fragments?: FragmentsBridge;
  }
}
