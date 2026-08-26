#!/usr/bin/env node
// What the Fracture map would plot, in text, before any of it is drawn.
//
//   npm run fracture
//
// Reads the managed library plus the measured seed audio, builds the same feature
// matrix and projection the app builds, and prints enough to judge them. If a
// drone's nearest neighbours are all drums, the bug is in the feature vector and
// no amount of layout work will hide it.

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLibraryService } from "../electron-dist/lib/domain/library-service.js";
import { resolveLibraryRoot } from "../electron-dist/lib/domain/paths.js";
import { measuredSummaryFrom } from "../electron-dist/lib/domain/measured-summary.js";
import { DIMENSIONS, rawVector } from "../electron-dist/lib/map/feature-vector.js";
import { buildFeatureMatrix } from "../electron-dist/lib/map/matrix.js";
import { explainedVariance, fitProjection, projectAll, topLoadings } from "../electron-dist/lib/map/projection.js";
import { collapseWholeTakes } from "../electron-dist/lib/map/collapse.js";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const libraryRoot = resolveLibraryRoot(path.join(os.homedir(), "Documents"));
const service = createLibraryService(libraryRoot);
const assets = [];

for (const source of await service.listSources()) {
  const duration = source.duration ?? 0;
  const summary = measuredSummaryFrom(source.analysis, duration);
  if (summary) {
    assets.push({ id: `source:${source.id}`, sourceId: source.id, kind: "source", duration, label: source.originalName, analysis: summary });
  }
  for (const fragment of source.fragments ?? []) {
    const span = fragment.end - fragment.start;
    const fragmentSummary = measuredSummaryFrom(fragment.analysis, span);
    if (!fragmentSummary) continue;
    assets.push({ id: fragment.id, sourceId: source.id, kind: "fragment", duration: span, label: `${source.originalName} · ${fragment.name}`, analysis: fragmentSummary });
  }
}

const seed = JSON.parse(await readFile(path.join(repoRoot, "app", "prototype-analysis.json"), "utf8"));
for (const [id, summary] of Object.entries(seed.fragments)) {
  assets.push({ id, sourceId: `seed:${id}`, kind: "fragment", duration: 6, label: `seed ${id}`, analysis: summary });
}

const placed = collapseWholeTakes(assets);
console.log(`${assets.length} assets, ${placed.length} after collapsing whole takes\n`);

const vectors = placed.map((asset) => rawVector(asset.analysis));
const matrix = buildFeatureMatrix(vectors);

console.log(`dimensions kept ${matrix.dimensions.length} of ${DIMENSIONS.length}`);
if (matrix.dropped.length) console.log(`dropped (no spread) ${matrix.dropped.join(", ")}`);

console.log("\nraw spread per dimension");
DIMENSIONS.forEach((dimension, column) => {
  const present = vectors.map((vector) => vector[column]).filter((value) => value !== null);
  if (present.length === 0) {
    console.log(`  ${dimension.name.padEnd(16)} not measured anywhere`);
    return;
  }
  const min = Math.min(...present);
  const max = Math.max(...present);
  console.log(`  ${dimension.name.padEnd(16)} ${present.length}/${vectors.length} measured   ${min.toFixed(3)} .. ${max.toFixed(3)}`);
});

const worst = placed
  .map((asset, index) => ({ label: asset.label, imputed: matrix.imputed[index] }))
  .sort((a, b) => b.imputed - a.imputed)
  .slice(0, 5);
console.log("\nmost-imputed assets");
for (const entry of worst) console.log(`  ${entry.imputed}/${DIMENSIONS.length}   ${entry.label}`);

const basis = fitProjection(matrix.rows, 6);
const ratios = explainedVariance(basis);
console.log("\nexplained variance");
ratios.forEach((ratio, index) => console.log(`  PC${index + 1}  ${(ratio * 100).toFixed(1)}%`));
const firstTwo = (ratios[0] ?? 0) + (ratios[1] ?? 0);
console.log(`  PC1+PC2 ${(firstTwo * 100).toFixed(1)}%`);
if (firstTwo > 0.8) {
  console.log("  WARNING: two components hold over 80%. The feature set is under-diversified.");
}

for (const component of [0, 1]) {
  console.log(`\nPC${component + 1} top loadings`);
  for (const loading of topLoadings(basis, matrix.dimensions, component, 6)) {
    console.log(`  ${loading.weight >= 0 ? "+" : "-"}${Math.abs(loading.weight).toFixed(3)}  ${loading.name}`);
  }
}

const points = projectAll(matrix.rows, basis);
const distance = (a, b) => Math.hypot(
  ...matrix.rows[a].map((value, index) => value - matrix.rows[b][index]),
);

console.log("\nnearest neighbours in feature space");
// Evenly spaced through the list rather than random, so the report is the same
// on every run and two runs can be compared.
const step = Math.max(1, Math.floor(placed.length / 5));
for (let index = 0; index < placed.length && index < step * 5; index += step) {
  console.log(`  ${placed[index].label}`);
  const neighbours = placed
    .map((asset, other) => ({ label: asset.label, other, gap: distance(index, other) }))
    .filter((entry) => entry.other !== index)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 5);
  for (const neighbour of neighbours) {
    console.log(`      ${neighbour.gap.toFixed(3)}  ${neighbour.label}`);
  }
}

const xs = points.map((point) => point.x);
const ys = points.map((point) => point.y);
console.log(`\nprojected extent  x ${Math.min(...xs).toFixed(2)} .. ${Math.max(...xs).toFixed(2)}   y ${Math.min(...ys).toFixed(2)} .. ${Math.max(...ys).toFixed(2)}`);
