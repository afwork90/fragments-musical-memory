import assert from "node:assert/strict";
import test from "node:test";

import { decodeWav } from "../../electron-dist/lib/analysis/wav.js";

/**
 * Builds a WAV in memory. `extraChunks` goes between `fmt ` and `data`, which is
 * where real recorders put `bext` and `junk` — one of the library's files does.
 */
function buildWav({ channels = 1, sampleRate = 22050, bitsPerSample = 16, samples = [], extraChunks = [] } = {}) {
  const bytesPerSample = bitsPerSample / 8;
  const dataBytes = samples.length * bytesPerSample;
  // Chunks are word-aligned: an odd-sized body is followed by a pad byte, as a
  // real file would have it.
  const padded = (length) => length + (length % 2);
  const extraBytes = extraChunks.reduce((total, chunk) => total + 8 + padded(chunk.body.length), 0);
  const buffer = new ArrayBuffer(12 + 24 + extraBytes + 8 + dataBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const writeAscii = (at, text) => {
    for (let i = 0; i < 4; i++) bytes[at + i] = text.charCodeAt(i);
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  writeAscii(8, "WAVE");

  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // linear PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, (sampleRate * channels * bitsPerSample) / 8, true);
  view.setUint16(32, (channels * bitsPerSample) / 8, true);
  view.setUint16(34, bitsPerSample, true);

  let offset = 36;
  for (const chunk of extraChunks) {
    writeAscii(offset, chunk.id);
    view.setUint32(offset + 4, chunk.body.length, true);
    bytes.set(chunk.body, offset + 8);
    offset += 8 + padded(chunk.body.length);
  }

  writeAscii(offset, "data");
  view.setUint32(offset + 4, dataBytes, true);
  let at = offset + 8;
  for (const sample of samples) {
    if (bitsPerSample === 16) view.setInt16(at, sample, true);
    else if (bitsPerSample === 32) view.setInt32(at, sample, true);
    else {
      view.setUint8(at, sample & 0xff);
      view.setUint8(at + 1, (sample >> 8) & 0xff);
      view.setUint8(at + 2, (sample >> 16) & 0xff);
    }
    at += bytesPerSample;
  }

  return bytes;
}

test("decodes 16-bit mono to normalised floats", () => {
  const wav = buildWav({ samples: [0, 16384, -16384, 32767] });
  const decoded = decodeWav(wav);

  assert.equal(decoded.sampleRate, 22050);
  assert.equal(decoded.channels, 1);
  assert.equal(decoded.bitsPerSample, 16);
  assert.equal(decoded.signal.length, 4);
  assert.equal(decoded.signal[0], 0);
  assert.ok(Math.abs(decoded.signal[1] - 0.5) < 1e-6);
  assert.ok(Math.abs(decoded.signal[2] + 0.5) < 1e-6);
  assert.ok(decoded.signal[3] > 0.999 && decoded.signal[3] <= 1);
});

test("averages channels to mono", () => {
  // Two frames: [1.0, 0.0] then [-1.0, 0.0]. Means are 0.5 and -0.5.
  const wav = buildWav({ channels: 2, samples: [32767, 0, -32768, 0] });
  const decoded = decodeWav(wav);

  assert.equal(decoded.channels, 2);
  assert.equal(decoded.signal.length, 2);
  assert.ok(Math.abs(decoded.signal[0] - 0.5) < 1e-4);
  assert.ok(Math.abs(decoded.signal[1] + 0.5) < 1e-4);
});

test("sign-extends 24-bit samples", () => {
  // 24-bit has no getInt24, so the sign bit is carried by hand. -4194304 is
  // exactly -0.5 at 24-bit, and would decode positive if sign extension were wrong.
  const wav = buildWav({ bitsPerSample: 24, samples: [0, 4194304, -4194304] });
  const decoded = decodeWav(wav);

  assert.equal(decoded.bitsPerSample, 24);
  assert.equal(decoded.signal[0], 0);
  assert.ok(Math.abs(decoded.signal[1] - 0.5) < 1e-6);
  assert.ok(Math.abs(decoded.signal[2] + 0.5) < 1e-6, `expected -0.5, got ${decoded.signal[2]}`);
});

test("24-bit reads every byte, not just the top two", () => {
  // 0x400000 and its negation have zero low bytes, so they pass whether or not the
  // low byte survives the shift. Full scale does not: dropping it read 0.9922.
  const wav = buildWav({ bitsPerSample: 24, samples: [8388607, -8388608, 0x123456] });
  const decoded = decodeWav(wav);

  assert.ok(Math.abs(decoded.signal[0] - 1) < 1e-6, `expected 1, got ${decoded.signal[0]}`);
  assert.equal(decoded.signal[1], -1);
  assert.ok(Math.abs(decoded.signal[2] - 0x123456 / 8388608) < 1e-9);
});

test("walks past chunks that precede data", () => {
  const wav = buildWav({
    samples: [16384],
    extraChunks: [
      { id: "bext", body: new Uint8Array(64).fill(7) },
      { id: "junk", body: new Uint8Array(28) },
    ],
  });
  const decoded = decodeWav(wav);

  assert.equal(decoded.signal.length, 1);
  assert.ok(Math.abs(decoded.signal[0] - 0.5) < 1e-6);
});

test("skips the pad byte after an odd-sized chunk", () => {
  const wav = buildWav({ samples: [16384], extraChunks: [{ id: "junk", body: new Uint8Array(3) }] });
  const decoded = decodeWav(wav);

  // A decoder that added `size` without the pad byte would land one byte short of
  // `data` and never find it.
  assert.equal(decoded.signal.length, 1);
  assert.ok(Math.abs(decoded.signal[0] - 0.5) < 1e-6);
});

test("trusts the file length over a data chunk that overruns it", () => {
  const wav = buildWav({ samples: [16384, -16384] });
  const view = new DataView(wav.buffer);
  view.setUint32(40, 0xffff, true); // claim far more data than exists

  const decoded = decodeWav(wav);
  assert.equal(decoded.signal.length, 2);
});

test("rejects what it cannot decode instead of guessing", () => {
  assert.throws(() => decodeWav(new Uint8Array(10)), /too short/);

  const notRiff = buildWav({ samples: [0] });
  notRiff[0] = 0x58;
  assert.throws(() => decodeWav(notRiff), /RIFF/);

  const eightBit = buildWav({ samples: [0] });
  new DataView(eightBit.buffer).setUint16(34, 8, true);
  assert.throws(() => decodeWav(eightBit), /bit depth/);

  const compressed = buildWav({ samples: [0] });
  new DataView(compressed.buffer).setUint16(20, 85, true); // MP3 in a WAV wrapper
  assert.throws(() => decodeWav(compressed), /linear PCM/);
});
