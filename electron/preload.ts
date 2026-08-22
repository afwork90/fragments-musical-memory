import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("fragments", {});
