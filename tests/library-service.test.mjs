import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createLibraryService } from "../lib/domain/library-service.mjs";

function validFinalizeMetadata(overrides = {}) {
  return {
    duration: 12.5,
    format: "wav",
    sampleRate: 44100,
    waveform: { version: 1, count: 3, peaks: [10, 20, 30] },
    analysis: { bpm: 120, key: "C", scale: "major", keyStrength: 0.8 },
    ...overrides,
  };
}

async function withTempDirs(run) {
  const root = await mkdtemp(path.join(tmpdir(), "fragments-library-"));
  const libraryRoot = path.join(root, "library");
  const fixturesDir = path.join(root, "fixtures");
  try {
    await run({ libraryRoot, fixturesDir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function makeFixtureFile(fixturesDir, name, contents) {
  const filePath = path.join(fixturesDir, name);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(fixturesDir, { recursive: true });
  await writeFile(filePath, contents);
  return filePath;
}

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

test("beginImport copies the audio file and writes a pending source document", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixtureContents = Buffer.from("RIFF-fake-wav-bytes-for-testing");
    const fixturePath = await makeFixtureFile(fixturesDir, "take-one.wav", fixtureContents);

    const service = createLibraryService(libraryRoot);
    const document = await service.beginImport(fixturePath);

    assert.equal(document.schemaVersion, 1);
    assert.equal(document.originalName, "take-one.wav");
    assert.equal(document.audioFile, "original.wav");
    assert.equal(document.contentHash, sha256Hex(fixtureContents));
    assert.equal(document.duration, null);
    assert.deepEqual(document.fragments, []);
    assert.ok(typeof document.id === "string" && document.id.length > 0);
    assert.ok(typeof document.importedAt === "string" && document.importedAt.length > 0);

    const copiedPath = path.join(libraryRoot, "sources", document.id, "original.wav");
    const copiedContents = await readFile(copiedPath);
    assert.deepEqual(copiedContents, fixtureContents);

    const sourceJsonPath = path.join(libraryRoot, "sources", document.id, "source.json");
    const persisted = JSON.parse(await readFile(sourceJsonPath, "utf8"));
    assert.deepEqual(persisted, document);
  });
});

test("beginImport removes the orphaned source directory when the input file is missing", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const missingPath = path.join(fixturesDir, "does-not-exist.wav");
    const service = createLibraryService(libraryRoot);

    await assert.rejects(() => service.beginImport(missingPath), /ENOENT/);

    const sourcesDir = path.join(libraryRoot, "sources");
    const entries = await readdir(sourcesDir).catch(() => []);
    assert.deepEqual(entries, [], "no orphaned source directory should remain after a failed import");
  });
});

test("listSources reads persisted documents from a fresh service instance", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "restart-check.wav", Buffer.from("second fixture"));

    const firstInstance = createLibraryService(libraryRoot);
    const created = await firstInstance.beginImport(fixturePath);

    const restartedInstance = createLibraryService(libraryRoot);
    const listed = await restartedInstance.listSources();

    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0], created);
  });
});

test("listSources skips a corrupt source.json and still returns the valid sources", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const goodFixture = await makeFixtureFile(fixturesDir, "good.wav", Buffer.from("good fixture"));
    const badFixture = await makeFixtureFile(fixturesDir, "bad.wav", Buffer.from("bad fixture"));
    const service = createLibraryService(libraryRoot);

    const good = await service.beginImport(goodFixture);
    const bad = await service.beginImport(badFixture);

    const corruptPath = path.join(libraryRoot, "sources", bad.id, "source.json");
    await writeFile(corruptPath, "{ not valid json ][", "utf8");

    const listed = await service.listSources();

    assert.equal(listed.length, 1);
    assert.deepEqual(listed[0], good);
  });
});

test("finalizeImport merges measured metadata and adds one whole-file fragment", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "finalize-me.wav", Buffer.from("third fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);

    const finalized = await service.finalizeImport(created.id, {
      duration: 12.5,
      format: "wav",
      sampleRate: 44100,
      waveform: { version: 1, count: 3, peaks: [10, 20, 30] },
      analysis: { bpm: 120, key: "C", scale: "major", keyStrength: 0.8 },
    });

    assert.equal(finalized.duration, 12.5);
    assert.equal(finalized.sampleRate, 44100);
    assert.equal(finalized.fragments.length, 1);
    assert.equal(finalized.fragments[0].start, 0);
    assert.equal(finalized.fragments[0].end, 12.5);
    assert.deepEqual(finalized.analysis, { bpm: 120, key: "C", scale: "major", keyStrength: 0.8 });

    const reread = await createLibraryService(libraryRoot).listSources();
    assert.deepEqual(reread[0], finalized);
  });
});

async function assertFinalizeRejected(service, sourceId, metadataOverrides, messagePattern) {
  const beforeList = await service.listSources();
  const beforeDocument = beforeList.find((document) => document.id === sourceId);

  await assert.rejects(
    () => service.finalizeImport(sourceId, validFinalizeMetadata(metadataOverrides)),
    messagePattern,
  );

  const afterList = await service.listSources();
  const afterDocument = afterList.find((document) => document.id === sourceId);
  assert.deepEqual(afterDocument, beforeDocument);
  assert.equal(afterDocument.duration, null);
  assert.deepEqual(afterDocument.fragments, []);
}

test("finalizeImport rejects a non-positive duration and leaves the source pending", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "bad-duration.wav", Buffer.from("fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);

    await assertFinalizeRejected(service, created.id, { duration: 0 }, /duration/i);
    await assertFinalizeRejected(service, created.id, { duration: Number.POSITIVE_INFINITY }, /duration/i);
    await assertFinalizeRejected(service, created.id, { duration: "12" }, /duration/i);
  });
});

test("finalizeImport rejects a non-positive or non-finite sampleRate and leaves the source pending", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "bad-sample-rate.wav", Buffer.from("fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);

    await assertFinalizeRejected(service, created.id, { sampleRate: 0 }, /sampleRate/i);
    await assertFinalizeRejected(service, created.id, { sampleRate: Number.NaN }, /sampleRate/i);
  });
});

test("finalizeImport rejects a waveform whose count does not match its peaks, and leaves the source pending", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "bad-waveform-count.wav", Buffer.from("fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);

    await assertFinalizeRejected(
      service,
      created.id,
      { waveform: { version: 1, count: 5, peaks: [1, 2, 3] } },
      /waveform/i,
    );
    await assertFinalizeRejected(
      service,
      created.id,
      { waveform: { version: 2, count: 3, peaks: [1, 2, 3] } },
      /waveform/i,
    );
  });
});

test("finalizeImport rejects a waveform containing a non-finite peak, and leaves the source pending", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "bad-waveform-peak.wav", Buffer.from("fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);

    await assertFinalizeRejected(
      service,
      created.id,
      { waveform: { version: 1, count: 3, peaks: [1, Number.NaN, 3] } },
      /waveform/i,
    );
  });
});

test("finalizeImport rejects invalid analysis fields, and leaves the source pending", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "bad-analysis.wav", Buffer.from("fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);

    await assertFinalizeRejected(
      service,
      created.id,
      { analysis: { bpm: "fast", key: "C", scale: "major", keyStrength: 0.8 } },
      /analysis/i,
    );
    await assertFinalizeRejected(
      service,
      created.id,
      { analysis: { bpm: 120, key: 42, scale: "major", keyStrength: 0.8 } },
      /analysis/i,
    );
    await assertFinalizeRejected(
      service,
      created.id,
      { analysis: { bpm: 120, key: "C", scale: "major", keyStrength: Number.NaN } },
      /analysis/i,
    );
  });
});

test("finalizeImport accepts null-valued analysis fields", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "null-analysis.wav", Buffer.from("fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);

    const finalized = await service.finalizeImport(
      created.id,
      validFinalizeMetadata({ analysis: { bpm: null, key: null, scale: null, keyStrength: null } }),
    );
    assert.deepEqual(finalized.analysis, { bpm: null, key: null, scale: null, keyStrength: null });
  });
});

test("updateSourceAnalysis merges analysis into an existing source document", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "update-analysis.wav", Buffer.from("analysis fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);
    await service.finalizeImport(created.id, validFinalizeMetadata());

    const updated = await service.updateSourceAnalysis(created.id, {
      bpm: 104,
      key: "A",
      scale: "minor",
      keyStrength: 72,
    });

    assert.equal(updated.analysis.bpm, 104);
    assert.equal(updated.analysis.key, "A");
    const listed = await service.listSources();
    assert.equal(listed.find((item) => item.id === created.id)?.analysis.bpm, 104);
  });
});

test("updateFragments overwrites the fragment list on an existing source document", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "update-fragments.wav", Buffer.from("fragments fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);
    await service.finalizeImport(created.id, validFinalizeMetadata());

    const sliced = [
      { id: "frag-1", name: "Intro", start: 0, end: 4, roles: ["Melody"], primaryRole: "Melody", userTags: [], analysis: { bpm: 90, key: "C", scale: "major", keyStrength: 0.8 }, analysisRevision: 1 },
      { id: "frag-2", name: "Outro", start: 4, end: 8, roles: ["Texture"], primaryRole: "Texture", userTags: [], analysis: { bpm: null, key: null, scale: null, keyStrength: null }, analysisRevision: 1 },
    ];
    const updated = await service.updateFragments(created.id, sliced);

    assert.equal(updated.fragments.length, 2);
    assert.equal(updated.fragments[0].id, "frag-1");
    const listed = await service.listSources();
    assert.equal(listed.find((item) => item.id === created.id)?.fragments.length, 2);
  });
});

test("resolveAudioPath returns the managed copy path for a known source", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "resolve-me.wav", Buffer.from("fourth fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);

    const resolved = service.resolveAudioPath(created.id, created.audioFile);
    assert.equal(resolved, path.join(libraryRoot, "sources", created.id, created.audioFile));
    const contents = await readFile(resolved);
    assert.deepEqual(contents, Buffer.from("fourth fixture"));
  });
});

test("resolveAudioPath rejects a traversal attempt through the audio filename", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "traverse-me.wav", Buffer.from("fifth fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);

    assert.throws(() => service.resolveAudioPath(created.id, "../../../etc/passwd"), /path separators|traversal/i);
    assert.throws(() => service.resolveAudioPath(created.id, "../original.wav"), /path separators|traversal/i);
  });
});

test("resolveAudioPath rejects an unsafe source id", async () => {
  await withTempDirs(async ({ libraryRoot }) => {
    const service = createLibraryService(libraryRoot);
    assert.throws(() => service.resolveAudioPath("../../etc", "original.wav"), /identifier|traversal/i);
  });
});

test("atomicWriteJson removes the temp file and leaves source.json intact when rename fails", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "rename-fail.wav", Buffer.from("fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);
    const sourceDir = path.join(libraryRoot, "sources", created.id);
    const sourceJsonPath = path.join(sourceDir, "source.json");
    const beforeContents = await readFile(sourceJsonPath, "utf8");

    const fsModule = await import("node:fs");
    const originalRename = fsModule.promises.rename;
    fsModule.promises.rename = async () => {
      throw new Error("simulated rename failure");
    };

    try {
      await assert.rejects(
        () => service.finalizeImport(created.id, validFinalizeMetadata()),
        /simulated rename failure/,
      );
    } finally {
      fsModule.promises.rename = originalRename;
    }

    const entries = await readdir(sourceDir);
    const tempFiles = entries.filter((name) => name.includes(".tmp"));
    assert.deepEqual(tempFiles, [], "temp file must be removed after a failed rename");
    assert.ok(entries.includes("source.json"));

    const afterContents = await readFile(sourceJsonPath, "utf8");
    assert.equal(afterContents, beforeContents, "source.json must be untouched after a failed rename");
  });
});

test("writes JSON atomically, leaving no temporary files behind", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "atomic-check.wav", Buffer.from("sixth fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);
    await service.finalizeImport(created.id, {
      duration: 1,
      format: "wav",
      sampleRate: 44100,
      waveform: { version: 1, count: 1, peaks: [5] },
      analysis: { bpm: null, key: null, scale: null, keyStrength: null },
    });

    const sourceDir = path.join(libraryRoot, "sources", created.id);
    const files = (await readdir(sourceDir)).sort();
    assert.deepEqual(files, ["original.wav", "source.json"]);
  });
});
