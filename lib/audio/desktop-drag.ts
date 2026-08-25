"use client";

// Dragging a waveform out of the app onto the desktop (e.g. into a DAW) needs
// a real OS-level file drag, which only Electron's `startDrag` can start.
// Outside Electron we fall back to the browser's `DownloadURL` dataTransfer
// trick, which some apps accept but is far less reliable.

import type { DragTarget } from "../ipc/contract";
import { getFragmentsBridge } from "../web/bridge";

/** Only a host that can hand a real file to another application counts here. */
function bridge() {
  const resolved = getFragmentsBridge();
  return resolved?.capabilities.drag ? resolved : null;
}

export function canDragToDesktop(): boolean {
  return typeof bridge()?.startDrag === "function";
}

/** `target.sourceId` resolves through the managed library; `target.assetPath`
 * (e.g. "/audio/f01.wav") resolves against bundled app assets — use whichever
 * the caller actually has. */
export function startDesktopDrag(
  event: React.DragEvent,
  target: DragTarget,
  fallback?: { audioUrl: string; fileName: string },
) {
  const desktop = bridge();
  if (desktop?.startDrag) {
    event.preventDefault();
    desktop.startDrag(target);
    return;
  }
  if (!fallback?.audioUrl) return;
  const url = new URL(fallback.audioUrl, window.location.href).href;
  event.dataTransfer.setData("text/uri-list", url);
  event.dataTransfer.setData("DownloadURL", `audio/wav:${fallback.fileName}:${url}`);
  event.dataTransfer.effectAllowed = "copy";
}
