// Recompute waveform peaks for bundled prototype audio (f01.wav..f28.wav).
// Pure Node — no Essentia, no network, no API keys.
//
//   node scripts/compute-prototype-waveforms.mjs
//   npm run compute-waveforms
//
// Writes app/prototype-waveforms.json (imported by prototype-data.ts).
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PEAK_COUNT, peaksFromWavFile } from "../lib/audio/wav-peaks.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const audioDir = path.join(repoRoot, "public", "audio");
const outputPath = path.join(repoRoot, "app", "prototype-waveforms.json");

async function main() {
  const files = (await readdir(audioDir))
    .filter((name) => /^f\d{2}\.wav$/.test(name))
    .sort();

  if (files.length === 0) {
    throw new Error(`No f??.wav files found in ${audioDir}`);
  }

  const fragments = {};
  const meta = {};

  for (const name of files) {
    const fragmentId = name.replace(/\.wav$/, "");
    const filePath = path.join(audioDir, name);
    const { peaks, duration, sampleRate } = await peaksFromWavFile(filePath, DEFAULT_PEAK_COUNT);

    fragments[fragmentId] = peaks;
    meta[fragmentId] = {
      file: name,
      duration,
      sampleRate,
      peakCount: peaks.length,
    };

    console.log(`${fragmentId}: ${peaks.length} peaks from ${name} (${duration.toFixed(2)}s)`);
  }

  const payload = {
    version: 1,
    peakCount: DEFAULT_PEAK_COUNT,
    generatedAt: new Date().toISOString(),
    fragments,
    meta,
  };

  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${outputPath} (${files.length} fragments)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
