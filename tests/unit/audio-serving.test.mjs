import assert from "node:assert/strict";
import test from "node:test";
import { audioMimeType, parseByteRange } from "../../electron-dist/lib/domain/audio-serving.js";

test("answers the whole file when nothing asked for a range", () => {
  assert.equal(parseByteRange(undefined, 1000), null);
});

test("reads a closed range", () => {
  assert.deepEqual(parseByteRange("bytes=100-199", 1000), { start: 100, end: 199 });
});

test("reads an open range as everything that is left", () => {
  assert.deepEqual(parseByteRange("bytes=100-", 1000), { start: 100, end: 999 });
});

test("reads a suffix range as the last bytes of the file", () => {
  assert.deepEqual(parseByteRange("bytes=-100", 1000), { start: 900, end: 999 });
});

test("clamps a suffix range longer than the file to the whole file", () => {
  assert.deepEqual(parseByteRange("bytes=-5000", 1000), { start: 0, end: 999 });
});

test("clamps an end past the last byte", () => {
  assert.deepEqual(parseByteRange("bytes=900-5000", 1000), { start: 900, end: 999 });
});

test("treats a start at or past the end of the file as unsatisfiable", () => {
  assert.equal(parseByteRange("bytes=1000-1200", 1000), "unsatisfiable");
});

test("treats any range against an empty file as unsatisfiable", () => {
  assert.equal(parseByteRange("bytes=0-", 0), "unsatisfiable");
});

test("ignores a reversed range rather than answering nonsense", () => {
  assert.equal(parseByteRange("bytes=500-100", 1000), null);
});

test("ignores a multi-range request, which is answered whole instead", () => {
  assert.equal(parseByteRange("bytes=0-99,200-299", 1000), null);
});

test("ignores a unit it does not understand", () => {
  assert.equal(parseByteRange("seconds=0-10", 1000), null);
});

test("names the audio types the library accepts", () => {
  assert.equal(audioMimeType("/library/take.wav"), "audio/wav");
  assert.equal(audioMimeType("/library/take.MP3"), "audio/mpeg");
  assert.equal(audioMimeType("/library/take.m4a"), "audio/mp4");
  assert.equal(audioMimeType("/library/take.aiff"), "audio/aiff");
  assert.equal(audioMimeType("/library/take.flac"), "audio/flac");
});

test("falls back to a generic type rather than guessing", () => {
  assert.equal(audioMimeType("/library/take.xyz"), "application/octet-stream");
  assert.equal(audioMimeType("/library/take"), "application/octet-stream");
});
