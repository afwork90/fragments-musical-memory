import assert from "node:assert/strict";
import test from "node:test";

import { encodeWav } from "../../electron-dist/lib/analysis/wav-encode.js";
import { decodeWav } from "../../electron-dist/lib/analysis/wav.js";

test("what it writes, the decoder beside it reads back", () => {
  const signal = new Float32Array([0, 0.5, -0.5, 0.25, -0.25, 1, -1]);

  const decoded = decodeWav(encodeWav([signal], 22050));

  assert.equal(decoded.sampleRate, 22050);
  assert.equal(decoded.channels, 1);
  assert.equal(decoded.bitsPerSample, 24);
  assert.equal(decoded.signal.length, signal.length);
  // 24-bit quantisation, so exact equality is not on offer; a sample is worth
  // about 1.2e-7.
  for (let index = 0; index < signal.length; index++) {
    assert.ok(Math.abs(decoded.signal[index] - signal[index]) < 1e-6);
  }
});

test("stereo is interleaved and averages back to mono", () => {
  const left = new Float32Array([1, 1, 1]);
  const right = new Float32Array([0, 0, 0]);

  const bytes = encodeWav([left, right], 48000);
  const decoded = decodeWav(bytes);

  assert.equal(decoded.channels, 2);
  assert.equal(decoded.sampleRate, 48000);
  assert.equal(decoded.signal.length, 3);
  // The decoder averages channels, so a hard-left signal comes back at half.
  for (const sample of decoded.signal) assert.ok(Math.abs(sample - 0.5) < 1e-6);
});

test("the header describes the bytes that follow", () => {
  const bytes = encodeWav([new Float32Array(10)], 44100);

  assert.equal(bytes.length, 44 + 10 * 3);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(view.getUint32(40, true), 10 * 3);
  // Byte rate and block align have to agree with 24-bit mono or a DAW misreads it.
  assert.equal(view.getUint32(28, true), 44100 * 3);
  assert.equal(view.getUint16(32, true), 3);
});

test("samples beyond full scale clamp rather than wrap", () => {
  const decoded = decodeWav(encodeWav([new Float32Array([2, -2])], 22050));

  assert.ok(decoded.signal[0] > 0.99);
  assert.ok(decoded.signal[1] < -0.99);
});

test("an unfilled stretch buffer reads as silence, not as a click", () => {
  const decoded = decodeWav(encodeWav([new Float32Array([NaN, 0.5])], 22050));

  assert.equal(decoded.signal[0], 0);
});

test("it refuses inputs it cannot describe honestly", () => {
  assert.throws(() => encodeWav([], 22050), /at least one channel/);
  assert.throws(() => encodeWav([new Float32Array(2)], 0), /positive sample rate/);
  assert.throws(
    () => encodeWav([new Float32Array(2), new Float32Array(3)], 22050),
    /equal length/,
  );
});
