import path from "node:path";

export function resolveRendererPath(root: string, pathname: string): string | null {
  const relative = decodeURIComponent(pathname)
    .replace(/^\/\.\//, "/")
    .replace(/^\/+/, "") || "index.html";
  const resolved = path.resolve(root, relative);
  const prefix = `${path.resolve(root)}${path.sep}`;
  return resolved === path.resolve(root) || resolved.startsWith(prefix)
    ? resolved
    : null;
}
