import assert from "node:assert/strict";
import test from "node:test";

import { FEATURE_SAMPLE_RATE, resample } from "../../electron-dist/lib/analysis/resample.js";

test("returns the same array when the rate already matches", () => {
  const signal = new Float32Array([0.1, 0.2, 0.3]);
  assert.equal(resample(signal, 22050, 22050), signal);
});

test("halving the rate averages sample pairs", () => {
  const signal = new Float32Array([0, 1, 0, 1, 0, 1]);
  const out = resample(signal, 44100, 22050);

  assert.equal(out.length, 3);
  for (const value of out) assert.ok(Math.abs(value - 0.5) < 1e-6);
});

test("length follows the rate ratio", () => {
  const signal = new Float32Array(48000);
  assert.equal(resample(signal, 48000, 22050).length, Math.floor(48000 / (48000 / 22050)));
  assert.equal(resample(signal, 48000, 24000).length, 24000);
});

test("preserves a constant signal exactly", () => {
  const signal = new Float32Array(1000).fill(0.25);
  for (const value of resample(signal, 48000, FEATURE_SAMPLE_RATE)) {
    assert.ok(Math.abs(value - 0.25) < 1e-6);
  }
});

test("averaging attenuates a tone above the new Nyquist rather than folding it back", () => {
  // Alternating +1/-1 at 44.1kHz is 22.05kHz — above the 11.025kHz Nyquist of the
  // target rate. Plain decimation would alias it to a loud low tone; box
  // averaging cancels it toward silence.
  const signal = new Float32Array(2000);
  for (let i = 0; i < signal.length; i++) signal[i] = i % 2 === 0 ? 1 : -1;

  const out = resample(signal, 44100, FEATURE_SAMPLE_RATE);
  let peak = 0;
  for (const value of out) peak = Math.max(peak, Math.abs(value));
  assert.ok(peak < 0.1, `expected the tone to be suppressed, saw peak ${peak}`);
});

test("rejects nonsensical rates", () => {
  const signal = new Float32Array([1, 2, 3]);
  assert.throws(() => resample(signal, 0, 22050), /positive/);
  assert.throws(() => resample(signal, 44100, -1), /positive/);
});
