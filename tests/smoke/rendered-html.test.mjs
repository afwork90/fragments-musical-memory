import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MAP_SCALE_MAX, MAP_SCALE_MIN, MAP_WORLD, fitMapCamera, musicalMapPoint, panMapCamera, zoomMapCameraAt } from "../../app/map-layout.mjs";

async function render() {
  const html = await readFile(
    new URL("../../dist/client/index.html", import.meta.url),
    "utf8",
  );
  return {
    status: 200,
    headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
    text: async () => html,
  };
}

test("renders the packaged Fragments shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Fragments — Rediscover your musical memory<\/title>/i);
  assert.match(html, /Fragments/);
  assert.match(html, /alt="Fragments"|brand-logo|Fragments home/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
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
