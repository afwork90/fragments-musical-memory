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
