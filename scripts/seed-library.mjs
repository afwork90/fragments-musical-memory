// One-off migration: copy the bundled prototype WAVs into the managed
// Electron library, as if each had been imported through the app. Run with:
//   node scripts/seed-library.mjs
//
// Only the 28 primary recordings (f01.wav..f28.wav) are migrated — derived
// stems/variants (f01_bass.wav, f02_match.wav, etc.) are prototype-only
// audition assets and are intentionally excluded.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLibraryService } from "../lib/domain/library-service.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const audioDir = path.join(repoRoot, "public", "audio");
const libraryRoot = process.env.FRAGMENTS_LIBRARY_ROOT
  || path.join(homedir(), "Documents", "Fragments Library");

function parseWavHeader(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = { start: body, length: size };
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error("missing fmt or data chunk");
  return { ...fmt, dataStart: data.start, dataLength: data.length };
}

function peaksFromPcm16(buffer, { channels, dataStart, dataLength }, count = 512) {
  const bytesPerFrame = 2 * channels;
  const frameCount = Math.floor(dataLength / bytesPerFrame);
  const blockSize = Math.max(1, Math.floor(frameCount / count));
  const peaks = [];
  for (let index = 0; index < count; index++) {
    const start = index * blockSize;
    const end = Math.min(frameCount, start + blockSize);
    let max = 0;
    for (let frame = start; frame < end; frame++) {
      const sampleOffset = dataStart + frame * bytesPerFrame;
      const sample = Math.abs(buffer.readInt16LE(sampleOffset)) / 32768;
      if (sample > max) max = sample;
    }
    peaks.push(Math.max(4, Math.round(max * 100)));
  }
  return peaks;
}

async function main() {
  const library = createLibraryService(libraryRoot);
  const files = (await readdir(audioDir))
    .filter((name) => /^f\d{2}\.wav$/.test(name))
    .sort();

  const existing = await library.listSources();
  const alreadyImported = new Set(existing.map((source) => source.originalName));

  console.log(`Library root: ${libraryRoot}`);
  console.log(`Found ${files.length} primary files; ${existing.length} sources already in library.`);

  let imported = 0;
  let skipped = 0;
  for (const name of files) {
    if (alreadyImported.has(name)) {
      skipped++;
      continue;
    }
    const filePath = path.join(audioDir, name);
    const buffer = await readFile(filePath);
    const header = parseWavHeader(buffer);
    if (header.bitsPerSample !== 16) {
      console.warn(`Skipping ${name}: unsupported bit depth ${header.bitsPerSample}`);
      continue;
    }
    const duration = header.dataLength / (header.channels * 2) / header.sampleRate;
    const peaks = peaksFromPcm16(buffer, header);

    const pending = await library.beginImport(filePath);
    await library.finalizeImport(pending.id, {
      duration,
      format: "WAV",
      sampleRate: header.sampleRate,
      waveform: { version: 1, count: peaks.length, peaks },
      analysis: { bpm: null, key: null, scale: null, keyStrength: null },
    });
    console.log(`Imported ${name} -> ${pending.id} (${duration.toFixed(2)}s)`);
    imported++;
  }

  console.log(`Done. Imported ${imported}, skipped ${skipped} already-present.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
