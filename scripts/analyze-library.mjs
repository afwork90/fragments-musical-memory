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

/**
 * Measures each fragment from its own slice of the source audio.
 *
 * Fragments cannot inherit their source's features. Every fragment of one
 * recording would then carry identical numbers, and an affinity scorer comparing
 * them would rank all of them as perfect matches for one another — which is
 * exactly as useless as it sounds, and indistinguishable from a working scorer
 * until you look at the output.
 *
 * Slices at the native rate and resamples per fragment, so a fragment measures the
 * same whether it was cut from a 48kHz master or a 22.05kHz one.
 */
function measureFragments(essentia, fragments, signal, sampleRate) {
  return fragments.map((fragment) => {
    const from = Math.max(0, Math.floor(fragment.start * sampleRate));
    const to = Math.min(signal.length, Math.ceil(fragment.end * sampleRate));

    if (to <= from) return { fragment, features: null, reason: "empty range" };

    // A copy, for the reason windowForFeatures documents: arrayToVector copies from
    // the backing buffer, so a subarray of a long recording would push the whole
    // recording into the WASM heap.
    const slice = signal.slice(from, to);
    const prepared = windowForFeatures(
      resample(slice, sampleRate, FEATURE_SAMPLE_RATE),
      FEATURE_SAMPLE_RATE,
    );

    try {
      const features = extractFeatures(essentia, prepared);
      // All-null means the slice was shorter than one analysis frame. Reporting that
      // as "measured" would overstate what happened.
      const anything = features.bpm !== null || features.key !== null || features.timbre !== null;
      return anything
        ? { fragment, features, reason: null }
        : { fragment, features: null, reason: "too short to measure" };
    } catch (error) {
      const message = typeof error === "number" ? `essentia aborted (${error})` : error?.message ?? String(error);
      return { fragment, features: null, reason: message };
    }
  });
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
    const intensityLabel = features.intensity === null
      ? "—"
      : features.intensity < 0 ? "relaxed" : features.intensity > 0 ? "aggressive" : "moderate";
    const trim = features.leadingSilence === null
      ? "—"
      : `${features.leadingSilence}s / ${features.trailingSilence}s`;
    console.log(`   level  ${features.lufs ?? "—"} LUFS   range ${features.loudnessRange ?? "—"}   dynamics ${features.dynamicComplexity ?? "—"}dB   rms ${features.rms ?? "—"}`);
    console.log(`   colour flatness ${features.flatness ?? "—"}   ${intensityLabel}   silence ${trim}`);
    console.log(`   wave   ${(waveform.byteLength / 1024).toFixed(0)}KB at ${PEAKS_PER_SECOND}/s${write ? " (written)" : ""}`);

    // Fragments are measured from their own slices, before the source-level
    // provenance gate below: a hand-corrected source BPM is a judgement about the
    // whole recording and says nothing about whether its fragments were measured.
    const fragments = source.fragments ?? [];
    const measurements = fragments.length
      ? measureFragments(essentia, fragments, decoded.signal, decoded.sampleRate)
      : [];

    if (measurements.length) {
      const done = measurements.filter((entry) => entry.features);
      const trustedTempo = done.filter((entry) => (entry.features.bpmConfidence ?? 0) >= MIN_BPM_CONFIDENCE);
      const short = measurements.filter((entry) => entry.reason === "too short to measure");
      const errored = measurements.filter((entry) => entry.reason && entry.reason !== "too short to measure");

      console.log(
        `   frags  ${done.length}/${measurements.length} measured`
        + `   ${trustedTempo.length} with a trusted tempo`
        + (short.length ? `   ${short.length} too short` : "")
        + (errored.length ? `   ${errored.length} failed` : ""),
      );
      for (const entry of errored) {
        console.log(`          ${entry.fragment.name}: ${entry.reason}`);
      }

      if (write) {
        const at = new Date().toISOString();
        // Preserve a fragment whose analysis a user corrected by hand, for the same
        // reason the source-level gate below exists.
        const next = measurements.map(({ fragment, features }) => {
          const editedByHand = fragment.analysis?.provenance?.origin === "edited";
          if (!features || (editedByHand && !force)) return fragment;
          return {
            ...fragment,
            analysis: {
              ...fragment.analysis,
              ...features,
              provenance: { origin: "measured", extractor: essentia.version, at },
            },
          };
        });
        await service.updateFragments(source.id, next);
        const written = next.filter((fragment, index) => fragment !== measurements[index].fragment).length;
        console.log(`          ${written} fragment analyses written`);
      }
    }

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
