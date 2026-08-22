import { app, net, protocol } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRendererPath } from "./resolve-renderer-path.js";

export { resolveRendererPath };

export const APP_SCHEME = "app";

export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function registerAppProtocol(): void {
  const root = path.join(app.getAppPath(), "dist", "client");
  protocol.handle(APP_SCHEME, (request) => {
    const pathname = new URL(request.url).pathname;
    const resolved = resolveRendererPath(root, pathname);
    if (!resolved) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(resolved).href);
  });
}

export function appUrl(): string {
  return `${APP_SCHEME}://./index.html`;
}
