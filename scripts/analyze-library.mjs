#!/usr/bin/env node
// Measures every source in the managed library with essentia and, with --write,
// persists the result as the source's analysis.
//
//   node scripts/analyze-library.mjs                 # measure and report, write nothing
//   node scripts/analyze-library.mjs --write         # persist
//   node scripts/analyze-library.mjs --id 4731d7d4   # one source, by id prefix
//   node scripts/analyze-library.mjs --write --force # include hand-edited analyses
//
// Requires `npm run build:electron` first: the analysis modules are typed and are
// consumed from electron-dist, the same build the app uses.
//
// Reads nothing from the renderer and writes through the same library service the
// app writes through, so a batch pass and an in-app analysis cannot diverge.

import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createLibraryService } from "../electron-dist/lib/domain/library-service.js";
import { resolveLibraryRoot } from "../electron-dist/lib/domain/paths.js";
import { decodeWav } from "../electron-dist/lib/analysis/wav.js";
import { resample, FEATURE_SAMPLE_RATE } from "../electron-dist/lib/analysis/resample.js";
import { extractFeatures, MIN_BPM_CONFIDENCE, windowForFeatures } from "../electron-dist/lib/analysis/features.js";
import { computePeaks, encodeWaveform, PEAKS_PER_SECOND } from "../electron-dist/lib/analysis/peaks.js";

// essentia's .es.js bundles reference __dirname and cannot load in Node, so the
// UMD build is used. That module *is* the Emscripten module: it carries the vector
// helpers, and the algorithms hang off its EssentiaJS class.
const require = createRequire(import.meta.url);

function loadEssentia() {
  const wasm = require("essentia.js/dist/essentia-wasm.umd.js");
  return {
    arrayToVector: (array) => wasm.arrayToVector(array),
    vectorToArray: (vector) => wasm.vectorToArray(vector),
    algorithms: new wasm.EssentiaJS(false),
    version: wasm.EssentiaJS ? "essentia.js@0.1.3" : "essentia.js",
  };
}

/**
 * Whether ffmpeg is on PATH. Optional on purpose: without it this script still does
 * everything it did before, and says which files it could not read.
 */
function hasFfmpeg() {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

/**
 * Decodes anything ffmpeg understands to a mono Float32Array at its native rate.
 *
 * Node has no MP3 decoder, which used to mean the browser was the only thing that
 * could measure a compressed file. Shelling out is honest — it is a real decode of
 * the real audio — and it means `npm run analyze` covers the whole library rather
 * than only its WAVs.
 */
function decodeWithFfmpeg(filePath) {
  // Parsed by key, not by position. ffprobe emits these in the stream's own field
  // order, not the order they were requested in, so reading them positionally
  // silently swapped rate and channel count — a sample rate of 2 then asked
  // `computePeaks` for 1.5 billion points and the process was killed.
  const probe = execFileSync("ffprobe", [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=sample_rate,channels",
    "-of", "default=noprint_wrappers=1",
    filePath,
  ], { encoding: "utf8" });

  const field = (name) => Number(new RegExp(`^${name}=(.+)$`, "m").exec(probe)?.[1]);
  const sampleRate = field("sample_rate");
  const channels = field("channels");
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`ffprobe reported no usable sample rate for ${path.basename(filePath)}`);
  }

  // f32le mono at the native rate: no resampling here, so the waveform is measured
  // from the audio as it exists. maxBuffer is generous because an hour of 48kHz
  // float mono is ~690MB and the default 1MB would truncate anything real.
  const raw = execFileSync("ffmpeg", [
    "-v", "error",
    "-i", filePath,
    "-f", "f32le",
    "-ac", "1",
    "-",
  ], { maxBuffer: 1024 * 1024 * 1024 });

  const usable = raw.byteLength - (raw.byteLength % 4);
  const signal = new Float32Array(usable / 4);
  // Copied rather than viewed: the Buffer's offset is not guaranteed 4-byte aligned.
  for (let i = 0; i < signal.length; i++) signal[i] = raw.readFloatLE(i * 4);

  return { signal, sampleRate, channels, bitsPerSample: 32 };
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const force = args.includes("--force");
const idFilter = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;

const libraryRoot = resolveLibraryRoot(path.join(os.homedir(), "Documents"));
const service = createLibraryService(libraryRoot);
const essentia = loadEssentia();
const ffmpeg = hasFfmpeg();

const sources = (await service.listSources())
  .filter((source) => !idFilter || source.id.startsWith(idFilter));

if (sources.length === 0) {
  console.error(idFilter ? `No source matches id prefix "${idFilter}".` : "The library is empty.");
  process.exit(1);
}

console.log(`${sources.length} source(s) in ${libraryRoot}`);
console.log(ffmpeg ? "ffmpeg found: every format is decodable." : "No ffmpeg on PATH: WAV only.");
console.log(write ? "Writing measured analysis to disk.\n" : "Dry run — pass --write to persist.\n");

let measured = 0;
let skipped = 0;
let failed = 0;

for (const source of sources) {
  const label = `${source.id.slice(0, 8)}  ${source.originalName ?? source.audioFile}`;
  const audioPath = service.resolveAudioPath(source.id, source.audioFile);

  const isWav = audioPath.toLowerCase().endsWith(".wav");

  // Without ffmpeg there is no way to read a compressed file here. Skipping is
  // honest; guessing would not be. The app measures it on first display instead.
  if (!isWav && !ffmpeg) {
    console.log(`${label}\n   SKIP  ${path.extname(audioPath) || "unknown"} needs ffmpeg, which is not on PATH; open it in the app to measure it\n`);
    skipped++;
    continue;
  }

  try {
    const decoded = isWav
      ? decodeWav(new Uint8Array(await readFile(audioPath)))
      : decodeWithFfmpeg(audioPath);
    const duration = (decoded.signal.length / decoded.sampleRate).toFixed(1);

    // The waveform first, and from the full-length signal: it is pure JS, so it
    // cannot fail the way essentia can, and a long recording should still get one
    // even if measuring its features does not work out.
    const waveform = encodeWaveform(computePeaks(decoded.signal, decoded.sampleRate, PEAKS_PER_SECOND));
    if (write) {
      // Written regardless of provenance: a waveform is a picture of the audio, not
      // a judgement a user could have corrected, so there is nothing to preserve.
      await service.writeWaveform(source.id, waveform);
    }

    // Capped before it reaches the WASM heap, and capped identically in the renderer.
    const signal = windowForFeatures(
      resample(decoded.signal, decoded.sampleRate, FEATURE_SAMPLE_RATE),
      FEATURE_SAMPLE_RATE,
    );
    const started = Date.now();
    const features = extractFeatures(essentia, signal);
    const elapsed = Date.now() - started;

    const source_ = `${decoded.bitsPerSample}-bit ${decoded.channels}ch ${decoded.sampleRate}Hz`;
    const resampled = decoded.sampleRate === FEATURE_SAMPLE_RATE ? "" : ` -> ${FEATURE_SAMPLE_RATE}Hz`;

    const confidence = features.bpmConfidence ?? 0;
    const trusted = features.bpm !== null && confidence >= MIN_BPM_CONFIDENCE;
    const bpmText = features.bpm === null
      ? "—"
      : `${features.bpm} (confidence ${confidence.toFixed(2)}${trusted ? "" : ", too low to trust"})`;
    const keyText = features.key ? `${features.key} ${features.scale ?? ""}`.trim() : "—";
    const previous = source.analysis ?? {};

    console.log(label);
    console.log(`   ${duration}s  ${source_}${resampled}  (${elapsed}ms)`);
    console.log(`   bpm    ${bpmText}${previous.bpm != null ? `   was ${previous.bpm}` : ""}`);
    console.log(`   key    ${keyText}${previous.key ? `   was ${previous.key} ${previous.scale ?? ""}`.trimEnd() : ""}`);
    console.log(`   onsets ${features.onsets ? features.onsets.length : "—"}`);
    console.log(`   timbre ${features.timbre ? `${features.timbre.length} MFCC means` : "—"}   chroma ${features.chroma ? `${features.chroma.length} bins` : "—"}   centroid ${features.centroidHz ?? "—"}Hz`);
    console.log(`   wave   ${(waveform.byteLength / 1024).toFixed(0)}KB at ${PEAKS_PER_SECOND}/s${write ? " (written)" : ""}`);

    // A hand-corrected value is the user's judgement and outranks any measurement.
    // Overwriting it in a batch pass is the exact failure the provenance field
    // exists to prevent.
    if (write && !force && previous.provenance?.origin === "edited") {
      console.log("   NOT written — this analysis was hand-edited; pass --force to overwrite");
      console.log();
      skipped++;
      continue;
    }

    if (write) {
      // updateSourceAnalysis merges, so the fields not measured here are left as
      // they are rather than being nulled.
      await service.updateSourceAnalysis(source.id, {
        ...features,
        provenance: { origin: "measured", extractor: essentia.version, at: new Date().toISOString() },
      });
      console.log("   written");
    }
    console.log();
    measured++;
  } catch (error) {
    // Emscripten throws bare numbers for C++ aborts.
    const message = typeof error === "number" ? `essentia aborted (${error})` : error?.message ?? String(error);
    console.log(`${label}\n   FAILED  ${message}\n`);
    failed++;
  }
}

console.log(`measured ${measured}, skipped ${skipped}, failed ${failed}`);
if (!write && measured > 0) console.log("Nothing was written. Re-run with --write to persist.");
