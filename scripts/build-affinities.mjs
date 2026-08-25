#!/usr/bin/env node
// Builds relationships between fragments from their measured features.
//
//   node scripts/build-affinities.mjs                # report, write nothing
//   node scripts/build-affinities.mjs --write        # persist
//   node scripts/build-affinities.mjs --min 0.6      # raise the similarity floor
//
// Requires `npm run build:electron` first, and requires the fragments to have been
// measured — run `npm run analyze -- --write` before this.
//
// Deterministic: same library in, same relationships out, with the same ids. It
// replaces the algorithmic relationships it owns and leaves anything a user marked
// or created alone.

import os from "node:os";
import path from "node:path";

import { createLibraryService } from "../electron-dist/lib/domain/library-service.js";
import { resolveLibraryRoot } from "../electron-dist/lib/domain/paths.js";
import { FEATURE_MAX_SECONDS } from "../electron-dist/lib/analysis/features.js";
import { generateRelationships, MIN_SIMILARITY } from "../electron-dist/lib/affinity/generate.js";
import { measuredAxes } from "../electron-dist/lib/domain/source-document.js";

const args = process.argv.slice(2);
const write = args.includes("--write");
const minSimilarity = args.includes("--min")
  ? Number(args[args.indexOf("--min") + 1])
  : MIN_SIMILARITY;

if (!Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 1) {
  console.error("--min must be between 0 and 1");
  process.exit(1);
}

const libraryRoot = resolveLibraryRoot(path.join(os.homedir(), "Documents"));
const service = createLibraryService(libraryRoot);

const sources = await service.listSources();
if (sources.length === 0) {
  console.error("The library is empty.");
  process.exit(1);
}

// Onsets were counted over the analysis window, not the whole fragment, so density
// must divide by what was actually measured.
const comparable = [];
for (const source of sources) {
  for (const fragment of source.fragments ?? []) {
    comparable.push({
      id: fragment.id,
      sourceId: source.id,
      measuredSeconds: Math.min(fragment.end - fragment.start, FEATURE_MAX_SECONDS),
      analysis: fragment.analysis ?? {},
    });
  }
}

const unmeasured = comparable.filter((fragment) => measuredAxes({
  rhythm: fragment.analysis.onsets ? 1 : null,
  harmony: fragment.analysis.chroma ? 1 : null,
  timbre: fragment.analysis.timbre ? 1 : null,
  tempo: fragment.analysis.bpm ?? null,
  pitch: fragment.analysis.key ? 1 : null,
  brightness: fragment.analysis.centroidHz ?? null,
}).length === 0);

console.log(`${sources.length} source(s), ${comparable.length} fragment(s) in ${libraryRoot}`);
if (unmeasured.length) {
  console.log(`${unmeasured.length} fragment(s) have no measured features — run npm run analyze -- --write`);
}
console.log(`similarity floor ${minSimilarity}`);
console.log(write ? "Writing relationships to disk.\n" : "Dry run — pass --write to persist.\n");

const relationships = generateRelationships(comparable, { minSimilarity });

// Same-source pairs are never candidates, so counting all pairs would overstate
// what was considered.
let pairs = 0;
for (let i = 0; i < comparable.length; i++) {
  for (let j = i + 1; j < comparable.length; j++) {
    if (comparable[i].sourceId !== comparable[j].sourceId) pairs++;
  }
}
console.log(`${relationships.length} relationship(s) from ${pairs} cross-source pair(s)\n`);

// Which axes actually carried the library, rather than which ones exist.
const axisCounts = new Map();
for (const relationship of relationships) {
  for (const axis of measuredAxes(relationship.metrics)) {
    axisCounts.set(axis, (axisCounts.get(axis) ?? 0) + 1);
  }
}
if (relationships.length) {
  console.log("axes measured across those relationships:");
  for (const [axis, count] of [...axisCounts].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${axis.padEnd(11)} ${count}  (${Math.round(count / relationships.length * 100)}%)`);
  }
  console.log();

  const strongest = [...relationships].sort((a, b) => b.base - a.base).slice(0, 5);
  const nameOf = new Map();
  for (const source of sources) {
    for (const fragment of source.fragments ?? []) nameOf.set(fragment.id, fragment.name);
  }
  console.log("strongest:");
  for (const relationship of strongest) {
    console.log(`   ${relationship.base.toFixed(3)}  ${nameOf.get(relationship.source)} + ${nameOf.get(relationship.target)}`);
    console.log(`          ${relationship.reason}`);
  }
  console.log();
}

if (!write) {
  console.log("Nothing was written. Re-run with --write to persist.");
  process.exit(0);
}

// A relationship is stored once, on the source owning its `source` fragment.
const bySource = new Map(sources.map((source) => [source.id, []]));
const sourceOfFragment = new Map();
for (const source of sources) {
  for (const fragment of source.fragments ?? []) sourceOfFragment.set(fragment.id, source.id);
}
for (const relationship of relationships) {
  bySource.get(sourceOfFragment.get(relationship.source))?.push(relationship);
}

for (const source of sources) {
  const generated = bySource.get(source.id) ?? [];

  // Anything the user touched is theirs. Only previously algorithmic relationships
  // are replaced, so a rebuild cannot discard a curated affinity.
  const preserved = (source.relationships ?? []).filter(
    (relationship) => relationship.origin && relationship.origin !== "algorithmic",
  );
  const preservedIds = new Set(preserved.map((relationship) => relationship.id));
  const next = [...preserved, ...generated.filter((relationship) => !preservedIds.has(relationship.id))];

  await service.updateRelationships(source.id, next);
  console.log(
    `${source.id.slice(0, 8)}  ${generated.length} generated`
    + (preserved.length ? `, ${preserved.length} preserved` : "")
    + " written",
  );
}

console.log(`\n${relationships.length} relationship(s) written.`);
