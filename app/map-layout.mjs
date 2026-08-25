export const MAP_WORLD = Object.freeze({ width:1280,height:760,padX:72,padY:62 });
export const MAP_SCALE_MIN = .28;
export const MAP_SCALE_MAX = 2.5;

const ROLE_TONAL = Object.freeze({ Texture:.08,Rhythm:.16,Bass:.40,Harmony:.64,Voice:.80,Melody:.92 });
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const stableHash = (value) => Array.from(value).reduce((hash,char) => ((hash * 31) + char.charCodeAt(0)) >>> 0,2166136261);

const keyCertainty = (key) => key === "—" || key.includes("No stable") ? .05 : key.includes("Could fit") ? .35 : key.includes("Likely") ? .75 : 1;

// Measured centroid in octaves between 150Hz and 4kHz, since brightness is heard
// ratiometrically. `brightness` is the demo dataset's hand-written stand-in; a measured
// fragment carries 0 there, which is why they all used to land on one line.
const CENTROID_OCTAVES = Math.log2(4000 / 150);

/** @param {{ brightness:number;measured?:{ centroidHz:number|null }|undefined }} fragment */
function brightnessOf(fragment) {
  const centroid = fragment.measured?.centroidHz;
  if (typeof centroid === "number" && centroid > 0) {
    return clamp(Math.log2(centroid / 150) / CENTROID_OCTAVES,0,1);
  }
  return clamp((fragment.brightness - 20) / 70,0,1);
}

/** @param {{ id:string;role:keyof typeof ROLE_TONAL;roles:Array<keyof typeof ROLE_TONAL>;key:string;brightness:number;measured?:{ centroidHz:number|null }|undefined }} fragment */
export function musicalMapPoint(fragment) {
  const primary=ROLE_TONAL[fragment.role] ?? .5;
  const secondaryRoles=fragment.roles.filter((role) => role !== fragment.role);
  const secondary=secondaryRoles.length ? secondaryRoles.reduce((sum,role) => sum + (ROLE_TONAL[role] ?? primary),0) / secondaryRoles.length : primary;
  const tonal=clamp((primary * .8 + secondary * .2) * .82 + keyCertainty(fragment.key) * .18,0,1);
  const brightness=brightnessOf(fragment);
  const hash=stableHash(fragment.id);
  const jitterX=((hash % 9) - 4) * 2.5;
  const jitterY=(((hash >>> 4) % 9) - 4) * 2;
  return {
    x:clamp(MAP_WORLD.padX + tonal * (MAP_WORLD.width - MAP_WORLD.padX * 2) + jitterX,MAP_WORLD.padX,MAP_WORLD.width - MAP_WORLD.padX),
    y:clamp(MAP_WORLD.padY + (1 - brightness) * (MAP_WORLD.height - MAP_WORLD.padY * 2) + jitterY,MAP_WORLD.padY,MAP_WORLD.height - MAP_WORLD.padY),
  };
}

/** @param {{x:number;y:number;scale:number}} camera @param {{width:number;height:number}} viewport */
export function clampMapCamera(camera,viewport) {
  const scale=clamp(camera.scale,MAP_SCALE_MIN,MAP_SCALE_MAX);
  const scaledWidth=MAP_WORLD.width * scale;
  const scaledHeight=MAP_WORLD.height * scale;
  const margin=48;
  const x=scaledWidth <= viewport.width ? (viewport.width - scaledWidth) / 2 : clamp(camera.x,viewport.width - scaledWidth - margin,margin);
  const y=scaledHeight <= viewport.height ? (viewport.height - scaledHeight) / 2 : clamp(camera.y,viewport.height - scaledHeight - margin,margin);
  return { x,y,scale };
}

/** @param {{width:number;height:number}} viewport */
export function fitMapCamera(viewport) {
  const scale=clamp(Math.min(1.05,(viewport.width - 64) / MAP_WORLD.width,(viewport.height - 64) / MAP_WORLD.height),MAP_SCALE_MIN,MAP_SCALE_MAX);
  return { x:(viewport.width - MAP_WORLD.width * scale) / 2,y:(viewport.height - MAP_WORLD.height * scale) / 2,scale };
}

/** @param {{x:number;y:number;scale:number}} camera @param {number} nextScale @param {{x:number;y:number}} cursor @param {{width:number;height:number}} viewport */
export function zoomMapCameraAt(camera,nextScale,cursor,viewport) {
  const scale=clamp(nextScale,MAP_SCALE_MIN,MAP_SCALE_MAX);
  const worldX=(cursor.x - camera.x) / camera.scale;
  const worldY=(cursor.y - camera.y) / camera.scale;
  return clampMapCamera({ x:cursor.x - worldX * scale,y:cursor.y - worldY * scale,scale },viewport);
}

/** @param {{x:number;y:number;scale:number}} camera @param {number} dx @param {number} dy @param {{width:number;height:number}} viewport */
export function panMapCamera(camera,dx,dy,viewport) {
  return clampMapCamera({ ...camera,x:camera.x + dx,y:camera.y + dy },viewport);
}
