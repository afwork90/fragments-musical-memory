import { contextBridge, ipcRenderer } from "electron";
import { FRAGMENTS_CHANNELS } from "../lib/ipc/contract.js";
import type { FragmentsBridge } from "../lib/ipc/contract.js";

// Typing the object as `FragmentsBridge` is what makes the contract real: adding
// a method to the interface without wiring it here is a compile error, and so is
// wiring one with the wrong argument types.
const bridge: FragmentsBridge = {
  capabilities: { import: true, persist: true, drag: true },
  pickAudioFile: () => ipcRenderer.invoke(FRAGMENTS_CHANNELS.pickAudio),
  beginImport: (filePath) => ipcRenderer.invoke(FRAGMENTS_CHANNELS.beginImport, filePath),
  finalizeImport: (id, metadata) =>
    ipcRenderer.invoke(FRAGMENTS_CHANNELS.finalizeImport, id, metadata),
  cancelImport: (id) => ipcRenderer.invoke(FRAGMENTS_CHANNELS.cancelImport, id),
  archiveSource: (id) => ipcRenderer.invoke(FRAGMENTS_CHANNELS.archiveSource, id),
  listSources: () => ipcRenderer.invoke(FRAGMENTS_CHANNELS.listSources),
  updateSourceAnalysis: (id, analysis) =>
    ipcRenderer.invoke(FRAGMENTS_CHANNELS.updateSourceAnalysis, id, analysis),
  updateSourceSettings: (id, settings) =>
    ipcRenderer.invoke(FRAGMENTS_CHANNELS.updateSourceSettings, id, settings),
  updateFragments: (id, fragments) =>
    ipcRenderer.invoke(FRAGMENTS_CHANNELS.updateFragments, id, fragments),
  updateRelationships: (id, relationships) =>
    ipcRenderer.invoke(FRAGMENTS_CHANNELS.updateRelationships, id, relationships),
  readWaveform: (id) => ipcRenderer.invoke(FRAGMENTS_CHANNELS.readWaveform, id),
  writeWaveform: (id, bytes) => ipcRenderer.invoke(FRAGMENTS_CHANNELS.writeWaveform, id, bytes),
  startDrag: (target) => ipcRenderer.send(FRAGMENTS_CHANNELS.startDrag, target),
};

contextBridge.exposeInMainWorld("fragments", bridge);
