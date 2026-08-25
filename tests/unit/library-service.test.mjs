import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createLibraryService } from "../../electron-dist/lib/domain/library-service.js";

test("updateFragments is idempotent for fragments stored without createdAt", async () => {
  // 48 of the 54 fragments in the real library predate the createdAt field, and
  // the renderer does not send one. Falling back to `now` re-stamped them on
  // every save, so editing an old source jumped its fragments to the top of a
  // "latest uploaded" sort. The source's own importedAt is the stable answer.
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const service = createLibraryService(libraryRoot);
    const filePath = await makeFixtureFile(fixturesDir, "take.wav", "audio-bytes");
    const pending = await service.beginImport(filePath);
    await service.finalizeImport(pending.id, validFinalizeMetadata());

    const stripped = [{
      id: `${pending.id}-a`,
      name: "a",
      start: 0,
      end: 4,
      roles: [],
      primaryRole: "Unclassified",
      userTags: [],
      analysis: { bpm: null, key: null, scale: null, keyStrength: null },
      analysisRevision: 1,
    }];

    const first = await service.updateFragments(pending.id, stripped);
    assert.equal(first.fragments[0].createdAt, pending.importedAt);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await service.updateFragments(pending.id, stripped);
    assert.equal(second.fragments[0].createdAt, first.fragments[0].createdAt);
  });
});

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

test("archiveSource hides a source from listSources but keeps its folder on disk", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "archive-me.wav", Buffer.from("archive fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);
    await service.finalizeImport(created.id, validFinalizeMetadata());

    await service.archiveSource(created.id);

    const listed = await service.listSources();
    assert.equal(listed.length, 0);

    const sourceDir = path.join(libraryRoot, "sources", created.id);
    const files = await readdir(sourceDir);
    assert.ok(files.includes("source.json"));
    assert.ok(files.includes("original.wav"));

    const archived = JSON.parse(await readFile(path.join(sourceDir, "source.json"), "utf8"));
    assert.ok(archived.deletedAt);
    assert.equal(archived.fragments.length, 1);
  });
});

test("beginImport restores a soft-deleted source with the same filename", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "restore-me.wav", Buffer.from("restore-by-filename fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);
    const sliced = [
      { id: "frag-1", name: "Intro", start: 0, end: 4, roles: [], primaryRole: "Unclassified", userTags: [], analysis: { bpm: 90, key: "C", scale: "major", keyStrength: 0.8 }, analysisRevision: 1 },
      { id: "frag-2", name: "Outro", start: 4, end: 8, roles: [], primaryRole: "Unclassified", userTags: [], analysis: { bpm: null, key: null, scale: null, keyStrength: null }, analysisRevision: 1 },
    ];
    await service.finalizeImport(created.id, validFinalizeMetadata());
    await service.updateFragments(created.id, sliced);
    await service.archiveSource(created.id);

    const reimportPath = await makeFixtureFile(fixturesDir, "restore-me.wav", Buffer.from("different bytes, same name"));
    const restored = await service.beginImport(reimportPath);

    assert.equal(restored.id, created.id);
    assert.equal(restored.restored, true);
    assert.equal(restored.deletedAt, null);
    assert.equal(restored.fragments.length, 2);
    assert.equal(restored.fragments[0].id, "frag-1");

    const listed = await service.listSources();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].fragments.length, 2);

    const sourceDirs = await readdir(path.join(libraryRoot, "sources"));
    assert.equal(sourceDirs.length, 1);
  });
});

test("deleteSource removes the folder, and the same file imports fresh afterwards", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "delete-me.wav", Buffer.from("delete fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);
    await service.finalizeImport(created.id, validFinalizeMetadata());
    await service.writeWaveform(created.id, new Uint8Array([1, 2, 3, 4]));

    await service.deleteSource(created.id);

    assert.equal((await service.listSources()).length, 0);
    assert.deepEqual(await readdir(path.join(libraryRoot, "sources")), []);

    // Nothing is left to restore, so the same filename imports as a new source
    // rather than reviving the old one the way an archived source would.
    const reimported = await service.beginImport(fixturePath);
    assert.notEqual(reimported.id, created.id);
    assert.equal(reimported.restored, undefined);
    assert.equal(reimported.fragments.length, 0);
  });
});

test("deleteSource refuses an id that is not a source rather than reporting success", async () => {
  await withTempDirs(async ({ libraryRoot }) => {
    const service = createLibraryService(libraryRoot);

    // `fs.rm` with `force` cannot tell "already gone" from "wrong id", so the
    // document is read first. A delete that quietly removes nothing would leave a
    // folder on disk that the app has already forgotten about.
    await assert.rejects(() => service.deleteSource("11111111-1111-4111-8111-111111111111"));
    await assert.rejects(() => service.deleteSource("../elsewhere"));
  });
});

test("beginImport rejects importing a file that is already active in the library", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const fixturePath = await makeFixtureFile(fixturesDir, "duplicate.wav", Buffer.from("duplicate fixture"));
    const service = createLibraryService(libraryRoot);
    const created = await service.beginImport(fixturePath);
    await service.finalizeImport(created.id, validFinalizeMetadata());

    await assert.rejects(() => service.beginImport(fixturePath), /already in your library/);

    const sourceDirs = await readdir(path.join(libraryRoot, "sources"));
    assert.equal(sourceDirs.length, 1);
  });
});

test("readWaveform reports absence rather than throwing", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const service = createLibraryService(libraryRoot);
    const filePath = await makeFixtureFile(fixturesDir, "take.wav", "audio");
    const pending = await service.beginImport(filePath);

    // Every source imported before sidecars existed is in this state. It has to
    // read as "none", not as an error, or the card cannot fall back to its thumbnail.
    assert.equal(await service.readWaveform(pending.id), null);
  });
});

test("a waveform sidecar survives a round trip through a fresh service", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const service = createLibraryService(libraryRoot);
    const filePath = await makeFixtureFile(fixturesDir, "take.wav", "audio");
    const pending = await service.beginImport(filePath);

    const bytes = new Uint8Array([0x46, 0x52, 0x57, 0x56, 1, 0, 200, 0, 2, 0, 0, 0]);
    await service.writeWaveform(pending.id, bytes);

    const reread = await createLibraryService(libraryRoot).readWaveform(pending.id);
    assert.deepEqual(Array.from(reread), Array.from(bytes));
  });
});

test("writing a waveform twice replaces it and leaves no temp files behind", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const service = createLibraryService(libraryRoot);
    const filePath = await makeFixtureFile(fixturesDir, "take.wav", "audio");
    const pending = await service.beginImport(filePath);

    await service.writeWaveform(pending.id, new Uint8Array([1, 2, 3, 4]));
    await service.writeWaveform(pending.id, new Uint8Array([9, 9]));

    assert.deepEqual(Array.from(await service.readWaveform(pending.id)), [9, 9]);

    // A leftover .tmp would be shipped as part of the library directory.
    const entries = await readdir(path.join(libraryRoot, "sources", pending.id));
    assert.deepEqual(entries.filter((name) => name.includes(".tmp")), []);
  });
});

test("a waveform sidecar does not enlarge source.json", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const service = createLibraryService(libraryRoot);
    const filePath = await makeFixtureFile(fixturesDir, "take.wav", "audio");
    const pending = await service.beginImport(filePath);
    const documentPath = path.join(libraryRoot, "sources", pending.id, "source.json");

    const before = (await readFile(documentPath)).byteLength;
    await service.writeWaveform(pending.id, new Uint8Array(80_000));
    const after = (await readFile(documentPath)).byteLength;

    // The whole point of the sidecar: the document rewritten on every metadata
    // edit stays small no matter how long the recording is.
    assert.equal(before, after);
  });
});

test("a waveform id cannot escape its source directory", async () => {
  await withTempDirs(async ({ libraryRoot }) => {
    const service = createLibraryService(libraryRoot);
    await assert.rejects(() => service.readWaveform("../../etc/passwd"), /identifier|traversal/);
    await assert.rejects(() => service.writeWaveform("..", new Uint8Array(1)), /identifier|traversal/);
  });
});

test("a render round-trips, and a missing one is not an error", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const service = createLibraryService(libraryRoot);
    const filePath = await makeFixtureFile(fixturesDir, "take.wav", "audio");
    const pending = await service.beginImport(filePath);
    const name = "frag_0-2000_t1050_p0_v1.wav";

    // Nothing rendered yet: the renderer makes it rather than reporting a failure.
    assert.equal(await service.readRender(pending.id, name), null);

    await service.writeRender(pending.id, name, new Uint8Array([1, 2, 3]));
    const reread = await createLibraryService(libraryRoot).readRender(pending.id, name);
    assert.deepEqual(Array.from(reread), [1, 2, 3]);
  });
});

test("renders are deleted with the source that owns them", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const service = createLibraryService(libraryRoot);
    const filePath = await makeFixtureFile(fixturesDir, "take.wav", "audio");
    const created = await service.beginImport(filePath);

    await service.writeRender(created.id, "a_0-1000_t1000_p0_v1.wav", new Uint8Array([1]));
    await service.deleteSource(created.id);

    // Derived data with no fragment to trace it back to is just a file taking space.
    assert.equal(await stat(path.join(libraryRoot, "sources", created.id)).catch(() => null), null);
  });
});

test("a source keeps a bounded number of renders", async () => {
  await withTempDirs(async ({ libraryRoot, fixturesDir }) => {
    const service = createLibraryService(libraryRoot);
    const filePath = await makeFixtureFile(fixturesDir, "take.wav", "audio");
    const pending = await service.beginImport(filePath);

    // Every distinct target BPM is a file, so a session at the tempo field would
    // otherwise leave a hundred of them.
    for (let index = 0; index < 24; index++) {
      await service.writeRender(pending.id, `f_0-1000_t${1000 + index}_p0_v1.wav`, new Uint8Array([index]));
    }

    const kept = await readdir(path.join(libraryRoot, "sources", pending.id, "renders"));
    assert.equal(kept.length, 16);
    // The most recent survive: the last write must still be readable.
    assert.ok(kept.includes("f_0-1000_t1023_p0_v1.wav"));
  });
});

test("a render name cannot escape the renders directory", async () => {
  await withTempDirs(async ({ libraryRoot }) => {
    const service = createLibraryService(libraryRoot);
    const id = "11111111-1111-4111-8111-111111111111";
    await assert.rejects(() => service.readRender(id, "../../source.json"), /separators|traversal/);
    await assert.rejects(() => service.writeRender(id, "..", new Uint8Array(1)), /relative path/);
    await assert.rejects(() => service.readRender("../elsewhere", "a.wav"), /identifier|traversal/);
  });
});
