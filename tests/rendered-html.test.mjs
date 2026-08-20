import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Fragments prototype", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Fragments — Rediscover your musical memory<\/title>/i);
  assert.match(html, /Fragments/);
  assert.match(html, />Fragments</);
  assert.match(html, /Sources/);
  assert.match(html, /2,418 ideas indexed/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships the complete staged musical corpus and interface data", async () => {
  const [data, page, audioFiles] = await Promise.all([
    readFile(new URL("../app/prototype-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readdir(new URL("../public/audio/", import.meta.url)),
  ]);
  assert.match(data, /Balcony guitar, 1:14am/);
  assert.match(data, /Kitchen hum \/ winter/);
  assert.match(data, /f02_match\.wav/);
  assert.match(page, /Fragmentation sensitivity/);
  assert.match(page, /advancedOpen/);
  assert.match(page, /wave-play/);
  assert.match(page, /Keep this for matching/);
  assert.ok(audioFiles.filter((name) => name.endsWith(".wav")).length >= 40);
  await assert.rejects(access(new URL("../app/_sites-preview/", import.meta.url)));
});
