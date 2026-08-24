import assert from "node:assert/strict";
import test from "node:test";

import {
  PEAKS_PER_SECOND,
  computePeaks,
  decodeWaveform,
  encodeWaveform,
  magnitudes,
  peaksForRange,
} from "../../electron-dist/lib/analysis/peaks.js";

function ramp(length, value = 0.5) {
  const signal = new Float32Array(length);
  signal.fill(value);
  return signal;
}

test("resolution follows duration, not a fixed count", () => {
  // The bug this replaces: a fixed 512 points meant a long file got coarse peaks.
  // Ten seconds and forty seconds must both yield the same points per second.
  const short = computePeaks(ramp(10 * 22050), 22050, 100);
  const long = computePeaks(ramp(40 * 22050), 22050, 100);

  assert.equal(short.pairs.length / 2, 10 * 100);
  assert.equal(long.pairs.length / 2, 40 * 100);
});

test("captures both extremes, not absolute magnitude", () => {
  // Asymmetric on purpose: +0.9 one half, -0.2 the other. Absolute-value peaks
  // would report 0.9 for both and lose the shape.
  const sampleRate = 1000;
  const signal = new Float32Array(1000);
  for (let i = 0; i < signal.length; i++) signal[i] = i < 500 ? 0.9 : -0.2;

  const waveform = computePeaks(signal, sampleRate, 2);
  assert.equal(waveform.pairs.length / 2, 2);

  const firstMin = waveform.pairs[0] / 32767;
  const firstMax = waveform.pairs[1] / 32767;
  const secondMin = waveform.pairs[2] / 32767;
  const secondMax = waveform.pairs[3] / 32767;

  assert.ok(Math.abs(firstMax - 0.9) < 0.001, `expected max 0.9, got ${firstMax}`);
  assert.ok(Math.abs(firstMin - 0.9) < 0.001);
  assert.ok(Math.abs(secondMin + 0.2) < 0.001, `expected min -0.2, got ${secondMin}`);
  assert.ok(Math.abs(secondMax + 0.2) < 0.001);
});

test("a transient inside a bucket survives", () => {
  // One loud sample among quiet ones must set the bucket's peak: skipping samples
  // for speed would drop exactly the detail that makes a waveform readable.
  const signal = new Float32Array(10000).fill(0.01);
  signal[7777] = 0.95;

  const waveform = computePeaks(signal, 10000, 1);
  assert.ok(Math.abs(waveform.pairs[1] / 32767 - 0.95) < 0.001);
});

test("clamps signals that exceed full scale", () => {
  // 2000Hz at 1000 points/s is two samples per point, so both land in one pair.
  const waveform = computePeaks(new Float32Array([4, -4]), 2000, 1000);
  assert.equal(waveform.pairs[0], -32767);
  assert.equal(waveform.pairs[1], 32767);
});

test("survives an encode/decode round trip", () => {
  const original = computePeaks(ramp(22050, 0.75), 22050, PEAKS_PER_SECOND);
  const restored = decodeWaveform(encodeWaveform(original));

  assert.equal(restored.peaksPerSecond, original.peaksPerSecond);
  assert.equal(restored.sampleRate, original.sampleRate);
  assert.deepEqual(Array.from(restored.pairs), Array.from(original.pairs));
});

test("preserves negative values through the round trip", () => {
  const signal = new Float32Array([-0.9, -0.9, 0.1, 0.1]);
  const restored = decodeWaveform(encodeWaveform(computePeaks(signal, 4000, 2000)));

  assert.ok(restored.pairs[0] < 0, "a negative minimum must stay negative");
  assert.ok(Math.abs(restored.pairs[0] / 32767 + 0.9) < 0.001);
});

test("rejects files it cannot read rather than rendering noise", () => {
  assert.throws(() => decodeWaveform(new Uint8Array(4)), /too short/);

  const wrongMagic = encodeWaveform(computePeaks(ramp(1000), 1000, 10));
  wrongMagic[0] = 0x58;
  assert.throws(() => decodeWaveform(wrongMagic), /not a waveform file/);

  const wrongVersion = encodeWaveform(computePeaks(ramp(1000), 1000, 10));
  new DataView(wrongVersion.buffer).setUint16(4, 99, true);
  assert.throws(() => decodeWaveform(wrongVersion), /unsupported waveform version/);
});

test("extracts a time range rather than the whole source", () => {
  // The bug this replaces: a slice that came out too short fell back to the
  // entire source, so a 2s fragment of a 6min file drew the whole recording.
  const sampleRate = 1000;
  const signal = new Float32Array(10 * sampleRate);
  // Only seconds 2-3 are loud.
  for (let i = 2 * sampleRate; i < 3 * sampleRate; i++) signal[i] = 0.8;

  const waveform = computePeaks(signal, sampleRate, 100);
  const inside = peaksForRange(waveform, 2, 3, 50);
  const outside = peaksForRange(waveform, 5, 6, 50);

  assert.ok(Math.max(...inside.max) > 0.7, "the loud second should read loud");
  assert.equal(Math.max(...outside.max), 0, "a silent second must read silent");
});

test("a very short range still yields its own detail", () => {
  const sampleRate = 22050;
  const signal = new Float32Array(346 * sampleRate);
  for (let i = 0; i < signal.length; i++) signal[i] = Math.sin(i / 50) * 0.5;

  // Two seconds of a 5.8-minute source: the case that previously gave 2 points.
  const waveform = computePeaks(signal, sampleRate, PEAKS_PER_SECOND);
  const range = peaksForRange(waveform, 100, 102, 400);

  assert.equal(range.max.length, 400);
  assert.ok(Math.max(...range.max) > 0.4);
});

test("does not invent more columns than were measured", () => {
  const waveform = computePeaks(ramp(1000, 0.5), 1000, 10);
  const range = peaksForRange(waveform, 0, 1, 10000);

  assert.ok(range.max.length <= 10, `asked for 10000, measured 10, got ${range.max.length}`);
});

test("zooming out keeps transients instead of averaging them away", () => {
  const sampleRate = 1000;
  const signal = new Float32Array(sampleRate).fill(0.02);
  signal[500] = 0.9;

  const waveform = computePeaks(signal, sampleRate, 100);
  const zoomedOut = peaksForRange(waveform, 0, 1, 4);

  assert.ok(Math.max(...zoomedOut.max) > 0.8, "the spike must survive decimation");
});

test("silence reads as zero, not as a floor", () => {
  const waveform = computePeaks(new Float32Array(1000), 1000, 10);
  const values = magnitudes(peaksForRange(waveform, 0, 1, 10));

  assert.deepEqual(values, new Array(values.length).fill(0));
});

test("magnitudes report the larger extreme", () => {
  const signal = new Float32Array([0.1, -0.6]);
  const values = magnitudes(peaksForRange(computePeaks(signal, 2000, 1000), 0, 1, 1));

  assert.equal(values[0], 60);
});

test("rejects nonsensical rates", () => {
  assert.throws(() => computePeaks(ramp(100), 0, 100), /sampleRate must be positive/);
  assert.throws(() => computePeaks(ramp(100), 1000, 0), /peaksPerSecond must be positive/);
  assert.throws(() => computePeaks(ramp(100), NaN, 100), /sampleRate must be positive/);
});

test("refuses a sample rate too low to be real audio", () => {
  // A metadata bug reported 2Hz for a 44.1kHz file. That sizes the output at
  // samples/(2/200) points — 1.5 billion for six minutes — and the process is killed
  // with nothing to read. Better to refuse than to try.
  assert.throws(() => computePeaks(ramp(15_000_000), 2, 200), /too low to be real audio/);
});
