import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("fragments", {
  pickAudioFile: () => ipcRenderer.invoke("fragments:pick-audio"),
  beginImport: (filePath: string) => ipcRenderer.invoke("fragments:begin-import", filePath),
  finalizeImport: (id: string, metadata: unknown) =>
    ipcRenderer.invoke("fragments:finalize-import", id, metadata),
  cancelImport: (id: string) => ipcRenderer.invoke("fragments:cancel-import", id),
  listSources: () => ipcRenderer.invoke("fragments:list-sources"),
});
