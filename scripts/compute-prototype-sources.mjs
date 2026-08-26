#!/usr/bin/env node
// Measures the bundled seed audio (public/audio/f01.wav..f28.wav) with the same
// extractor the library uses, and emits two things:
//
//   app/prototype-analysis.json                   what the renderer imports
//   public/audio/library-ready/<id>/source.json   valid library documents
//
//   npm run seed-docs              measure and write both artifacts
//   npm run seed-docs -- --install also copy the documents and audio into the
//                                  managed library, retiring the seed data for real
//
// Requires `npm run build:electron` first: the analysis modules are consumed from
// electron-dist, the same build the app uses, so a seed file and a library file
// cannot be measured differently.
//
// Nothing invented is written. The documents carry measured analysis, the
// filename, duration, sample rate, a content hash and a waveform thumbnail. The
// seed fragments' hand-written names, keys, BPMs and roles are not persisted.

import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeWav } from "../electron-dist/lib/analysis/wav.js";
import { resample, FEATURE_SAMPLE_RATE } from "../electron-dist/lib/analysis/resample.js";
import { extractFeatures, windowForFeatures } from "../electron-dist/lib/analysis/features.js";
import { PEAKS_PER_SECOND, computePeaks, magnitudes, peaksForRange } from "../electron-dist/lib/analysis/peaks.js";
import { measuredSummaryFrom } from "../electron-dist/lib/domain/measured-summary.js";
import { SCHEMA_VERSION, normalizeSourceDocument } from "../electron-dist/lib/domain/source-document.js";
import { resolveLibraryRoot } from "../electron-dist/lib/domain/paths.js";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const audioDir = path.join(repoRoot, "public", "audio");
const readyDir = path.join(audioDir, "library-ready");
const analysisPath = path.join(repoRoot, "app", "prototype-analysis.json");

// The thumbnail that lives in source.json. High-resolution peaks belong in a
// waveform.bin sidecar, never in a document parsed on every listSources().
const THUMBNAIL_POINTS = 512;

const require = createRequire(import.meta.url);

function loadEssentia() {
  const wasm = require("essentia.js/dist/essentia-wasm.umd.js");
  return {
    arrayToVector: (array) => wasm.arrayToVector(array),
    vectorToArray: (vector) => wasm.vectorToArray(vector),
    algorithms: new wasm.EssentiaJS(false),
    version: "essentia.js@0.1.3",
  };
}

/**
 * A UUID derived from the filename, so re-running the script does not churn the
 * generated ids and the JSON diff stays empty when nothing changed.
 */
function stableUuid(name) {
  const hex = createHash("sha1").update(`fragments-seed:${name}`).digest("hex");
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return [hex.slice(0, 8), hex.slice(8, 12), `5${hex.slice(13, 16)}`, `${variant}${hex.slice(18, 20)}`, hex.slice(20, 32)].join("-");
}

async function main() {
  const install = process.argv.slice(2).includes("--install");
  const files = (await readdir(audioDir)).filter((name) => /^f\d{2}\.wav$/.test(name)).sort();
  if (files.length === 0) throw new Error(`No f??.wav files found in ${audioDir}`);

  const essentia = loadEssentia();
  const at = new Date().toISOString();
  const summaries = {};
  const documents = [];

  for (const name of files) {
    const seedId = name.replace(/\.wav$/, "");
    const filePath = path.join(audioDir, name);
    const bytes = new Uint8Array(await readFile(filePath));
    const decoded = decodeWav(bytes);
    const duration = decoded.signal.length / decoded.sampleRate;

    const prepared = windowForFeatures(
      resample(decoded.signal, decoded.sampleRate, FEATURE_SAMPLE_RATE),
      FEATURE_SAMPLE_RATE,
    );
    const analysis = {
      ...extractFeatures(essentia, prepared),
      provenance: { origin: "measured", extractor: essentia.version, at },
    };

    const sourceId = stableUuid(name);
    // Measured at the normal rate, then reduced to the thumbnail. `magnitudes`
    // takes a `PeakRange`, which is what `peaksForRange` returns — `computePeaks`
    // returns `WaveformPeaks` and cannot be passed to it directly.
    const thumbnail = magnitudes(
      peaksForRange(computePeaks(decoded.signal, decoded.sampleRate, PEAKS_PER_SECOND), 0, duration, THUMBNAIL_POINTS),
    );

    const document = {
      schemaVersion: SCHEMA_VERSION,
      id: sourceId,
      // The filename, not the seed fragment's hand-written title. Nothing
      // invented reaches a source.json.
      originalName: name,
      audioFile: name,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      importedAt: at,
      deletedAt: null,
      duration,
      format: "wav",
      sampleRate: decoded.sampleRate,
      waveform: { version: 1, count: thumbnail.length, peaks: thumbnail },
      analysis,
      sourceTypes: [],
      sensitivity: 52,
      fragments: [{
        id: `${sourceId}-whole`,
        name,
        start: 0,
        end: duration,
        roles: [],
        // Nothing measures a musical role, so claiming one would be invention.
        primaryRole: "Unclassified",
        userTags: [],
        analysis,
        analysisRevision: 1,
        createdAt: at,
      }],
      relationships: [],
    };

    // Proves the document is a real library document and not merely
    // document-shaped. It throws rather than returning a verdict.
    normalizeSourceDocument(document);

    summaries[seedId] = measuredSummaryFrom(analysis, duration);
    documents.push({ seedId, sourceId, name, document });

    const bpm = analysis.bpm === null ? "—" : `${analysis.bpm} (confidence ${(analysis.bpmConfidence ?? 0).toFixed(2)})`;
    console.log(`${seedId}  ${duration.toFixed(2)}s  bpm ${bpm}  key ${analysis.key ?? "—"} ${analysis.scale ?? ""}  centroid ${analysis.centroidHz ?? "—"}Hz`);
  }

  await writeFile(
    analysisPath,
    `${JSON.stringify({ version: 1, generatedAt: at, extractor: essentia.version, fragments: summaries }, null, 2)}\n`,
    "utf8",
  );
  console.log(`\nWrote ${analysisPath} (${files.length} summaries)`);

  for (const { sourceId, document } of documents) {
    const dir = path.join(readyDir, sourceId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "source.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  }
  console.log(`Wrote ${documents.length} library-ready documents to ${readyDir}`);

  if (!install) {
    console.log("\nPass --install to copy these into the managed library.");
    return;
  }

  const libraryRoot = path.join(resolveLibraryRoot(path.join(os.homedir(), "Documents")), "sources");
  for (const { sourceId, name, document } of documents) {
    const dir = path.join(libraryRoot, sourceId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "source.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await copyFile(path.join(audioDir, name), path.join(dir, name));
  }
  console.log(`Installed ${documents.length} sources into ${libraryRoot}`);
}

main().catch((error) => {
  // Emscripten throws bare numbers for C++ aborts, so this cannot assume an Error.
  console.error(typeof error === "number" ? `essentia aborted (${error})` : error);
  process.exitCode = 1;
});
