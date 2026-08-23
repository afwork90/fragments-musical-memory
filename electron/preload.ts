import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("fragments", {
  pickAudioFile: () => ipcRenderer.invoke("fragments:pick-audio"),
  beginImport: (filePath: string) => ipcRenderer.invoke("fragments:begin-import", filePath),
  finalizeImport: (id: string, metadata: unknown) =>
    ipcRenderer.invoke("fragments:finalize-import", id, metadata),
  cancelImport: (id: string) => ipcRenderer.invoke("fragments:cancel-import", id),
  archiveSource: (id: string) => ipcRenderer.invoke("fragments:archive-source", id),
  listSources: () => ipcRenderer.invoke("fragments:list-sources"),
  updateSourceAnalysis: (id: string, analysis: unknown) =>
    ipcRenderer.invoke("fragments:update-source-analysis", id, analysis),
  updateFragments: (id: string, fragments: unknown) =>
    ipcRenderer.invoke("fragments:update-fragments", id, fragments),
  updateRelationships: (id: string, relationships: unknown) =>
    ipcRenderer.invoke("fragments:update-relationships", id, relationships),
  startDrag: (target: { sourceId?: string; assetPath?: string }) => ipcRenderer.send("fragments:start-drag", target),
});
