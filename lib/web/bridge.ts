// The single place the renderer asks for the bridge.
//
// Electron's preload puts one on `window.fragments`. In a browser there is no
// preload, so we build the HTTP-backed one instead. Either way the app gets a
// `FragmentsBridge` and never branches on which host it is running in — it
// branches on `bridge.capabilities`.

import type { FragmentsBridge } from "../ipc/contract";
import { createWebLibraryBridge } from "./library-bridge";

let webBridge: FragmentsBridge | null = null;

/**
 * `null` only during server-side rendering, where there is no window at all.
 *
 * A static web build with no dev server behind it still gets a bridge; its
 * `listSources` rejects and the caller reports a load failure, which is the
 * honest outcome — better than silently showing a fake library.
 */
export function getFragmentsBridge(): FragmentsBridge | null {
  if (typeof window === "undefined") return null;
  if (window.fragments) return window.fragments;
  webBridge ??= createWebLibraryBridge();
  return webBridge;
}
