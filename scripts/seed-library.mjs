// One-off migration: copy the bundled prototype WAVs into the managed
// Electron library, as if each had been imported through the app. Run with:
//   node scripts/seed-library.mjs
//
// Only the 28 primary recordings (f01.wav..f28.wav) are migrated — derived
// stems/variants (f01_bass.wav, f02_match.wav, etc.) are prototype-only
// audition assets and are intentionally excluded.
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLibraryService } from "../lib/domain/library-service.mjs";
import { peaksFromWavFile } from "../lib/audio/wav-peaks.mjs";
import { inventAnalysis } from "../lib/domain/invent-analysis.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const audioDir = path.join(repoRoot, "public", "audio");
const libraryRoot = process.env.FRAGMENTS_LIBRARY_ROOT
  || path.join(homedir(), "Documents", "Fragments Library");

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
    const { peaks, duration, sampleRate } = await peaksFromWavFile(filePath);

    const pending = await library.beginImport(filePath);
    const analysis = inventAnalysis(pending.id);
    await library.finalizeImport(pending.id, {
      duration,
      format: "WAV",
      sampleRate,
      waveform: { version: 1, count: peaks.length, peaks },
      analysis,
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
