import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { MAP_SCALE_MAX, MAP_SCALE_MIN, MAP_WORLD, fitMapCamera, musicalMapPoint, panMapCamera, zoomMapCameraAt } from "../app/map-layout.mjs";

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
  assert.match(html, /24(?:<!-- -->)? surfaced · 2,418 indexed/);
  assert.match(html, /Bars\/Beats/);
  assert.match(html, /Confidence/);
  assert.match(html, /Links/);
  assert.match(html, /Filter by Fragment/);
  assert.match(html, /Filter by Key/);
  assert.equal((html.match(/aria-haspopup="dialog"/g) ?? []).length,15);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships the complete staged musical corpus and interface data", async () => {
  const [data, page, workflow, workbench, filters, sourcesToolbar, libraryTable, libraryColumns, duplicateDialog, styles, audioFiles] = await Promise.all([
    readFile(new URL("../app/prototype-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/fragments-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/hero-workflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fragmentation-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/library-filter-popover.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/features/sources/sources-toolbar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/features/library/library-table.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/features/library/library-columns.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/features/library/duplicate-takes-dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readdir(new URL("../public/audio/", import.meta.url)),
  ]);
  assert.match(data, /Balcony guitar, 1:14am/);
  assert.match(data, /Kitchen hum \/ winter/);
  assert.match(data, /f02_match\.wav/);
  assert.match(page, /advancedOpen/);
  assert.match(page, /wave-play/);
  assert.match(page, /LibraryView/);
  assert.match(page, /SourcesView/);
  assert.match(libraryTable, /Filter by \$\{column\.label\}/);
  assert.match(libraryColumns, /Bars\/Beats/);
  assert.match(sourcesToolbar, /＋ Import/);
  assert.match(page, /Manual links/);
  assert.match(page, /linkSummaryFor/);
  assert.match(page, /map-inspector/);
  assert.match(page, /highlighted/);
  assert.match(page, /graph-canvas/);
  assert.match(page, /map-controls/);
  assert.match(page, /Unpitched \/ textural/);
  assert.match(page, /Pitched \/ melodic/);
  assert.match(page, /mapCamera:\{ \.\.\.mapCamera \}/);
  assert.doesNotMatch(page, /activeFragments\.slice\(0,18\)|GRAPH_POSITIONS/);
  assert.match(page, /relationshipIsTransformed/);
  assert.doesNotMatch(page, /transformationCost > \.1 \? "bridge"/);
  assert.match(page, /duplicateExclusions\.has\(fragment\.id\)/);
  assert.match(page, /mapRelationships\.map/);
  assert.match(filters, /Greater than/);
  assert.match(filters, /Less than/);
  assert.match(filters, /column === "date"/);
  assert.match(filters, /renderMulti\("key"/);
  assert.match(filters, /type="date"/);
  assert.match(filters, /resultCount/);
  assert.match(styles, /--node-compensation/);
  assert.match(styles, /--axis-font/);
  assert.match(page, /FragmentationWorkbench/);
  assert.match(page, /source-editor-overlay/);
  assert.match(page, /restoreReturn\("map-full"\)/);
  assert.match(page, /next\.length \? next : null/);
  assert.doesNotMatch(page, /CorrectionOverlay/);
  assert.match(workbench, /Fragmentation sensitivity/);
  assert.match(workbench, /fragment-lanes-scroll/);
  assert.match(workbench, /ruler-edge-magnifier/);
  assert.match(workbench, /fragment-scan-playhead/);
  assert.match(workbench, /＋ Add fragment/);
  assert.match(page, /No authored connections for this fragment/);
  assert.match(duplicateDialog, /Keep this for matching/);
  assert.doesNotMatch(page, /Audition connection|<span>Status<\/span>/);
  assert.match(data, /FragmentRef/);
  assert.match(data, /MatchTolerances/);
  assert.match(data, /sourceId/);
  assert.match(data, /Importing.*Segmenting.*Extracting metadata.*Matching.*Ready/s);
  assert.match(workflow, /Play A|\["A","B","A→B","B→A","Together"\]/);
  assert.match(workflow, /Previous candidate/);
  assert.match(workflow, /scan-playhead/);
  assert.doesNotMatch(workflow, /Why it connects|Download always works/);
  assert.match(workflow, /Drag into DAW/);
  assert.match(data, /rel\("r33"/);
  assert.match(data, /status:"manual"/);
  assert.match(data, /f28"[^\n]+Balcony guitar — clean pass, take 2[^\n]+duplicateGroup:"balcony"/);
  assert.match(data, /rel\("r14","f12","f21"/);
  assert.ok(audioFiles.filter((name) => name.endsWith(".wav")).length >= 40);
  await assert.rejects(access(new URL("../app/_sites-preview/", import.meta.url)));
});

test("keeps the musical map layout and camera math deterministic", () => {
  const fragment={ id:"f-test",role:"Rhythm",roles:["Rhythm"],key:"No stable key",brightness:74 };
  assert.deepEqual(musicalMapPoint(fragment),musicalMapPoint(fragment));
  const point=musicalMapPoint(fragment);
  assert.ok(point.x >= MAP_WORLD.padX && point.x <= MAP_WORLD.width - MAP_WORLD.padX);
  assert.ok(point.y >= MAP_WORLD.padY && point.y <= MAP_WORLD.height - MAP_WORLD.padY);

  const viewport={ width:960,height:640 };
  const fitted=fitMapCamera(viewport);
  assert.ok(fitted.scale >= MAP_SCALE_MIN && fitted.scale <= MAP_SCALE_MAX);
  const cursor={ x:410,y:280 };
  const worldBefore={ x:(cursor.x - fitted.x) / fitted.scale,y:(cursor.y - fitted.y) / fitted.scale };
  const zoomed=zoomMapCameraAt(fitted,fitted.scale * 1.3,cursor,viewport);
  const worldAfter={ x:(cursor.x - zoomed.x) / zoomed.scale,y:(cursor.y - zoomed.y) / zoomed.scale };
  assert.ok(Math.abs(worldBefore.x - worldAfter.x) < 1e-9);
  assert.ok(Math.abs(worldBefore.y - worldAfter.y) < 1e-9);
  assert.equal(zoomMapCameraAt(fitted,99,cursor,viewport).scale,MAP_SCALE_MAX);
  assert.equal(zoomMapCameraAt(fitted,.001,cursor,viewport).scale,MAP_SCALE_MIN);
  const panned=panMapCamera(zoomed,-120,70,viewport);
  assert.equal(panned.scale,zoomed.scale);
  const farLeft=panMapCamera({ x:0,y:0,scale:1 },-10_000,0,viewport);
  const farRight=panMapCamera({ x:0,y:0,scale:1 },10_000,0,viewport);
  assert.equal(farLeft.x,viewport.width - MAP_WORLD.width - 48);
  assert.equal(farRight.x,48);
  assert.equal(fitMapCamera({ width:360,height:600 }).scale,MAP_SCALE_MIN);
});
