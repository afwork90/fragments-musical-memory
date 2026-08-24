import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveRendererPath } from "../../electron-dist/electron/protocols/resolve-renderer-path.js";

const root = path.resolve("/fake/dist/client");

test("resolves the default document for the app root", () => {
  assert.equal(resolveRendererPath(root, "/"), path.join(root, "index.html"));
});

test("resolves a top-level file under the renderer root", () => {
  assert.equal(resolveRendererPath(root, "/index.html"), path.join(root, "index.html"));
});

test("resolves a nested asset path under the renderer root", () => {
  assert.equal(
    resolveRendererPath(root, "/_next/static/chunk.js"),
    path.join(root, "_next", "static", "chunk.js"),
  );
});

test("strips a leading dot-slash segment before resolving", () => {
  assert.equal(
    resolveRendererPath(root, "/./assets/app.js"),
    path.join(root, "assets", "app.js"),
  );
});

test("rejects an encoded path that escapes the renderer root", () => {
  assert.equal(resolveRendererPath(root, "/%2e%2e%2f%2e%2e%2fetc%2fpasswd"), null);
});

test("rejects a literal parent-directory traversal", () => {
  assert.equal(resolveRendererPath(root, "/../../etc/passwd"), null);
});

test("contains a doubled leading slash within the renderer root", () => {
  assert.equal(resolveRendererPath(root, "//etc/passwd"), path.join(root, "etc", "passwd"));
});

test("resolves a bare dot pathname to the renderer root itself", () => {
  assert.equal(resolveRendererPath(root, "/."), path.resolve(root));
});
