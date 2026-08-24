// Waveform peaks at a resolution that does not depend on how long the recording is.
//
// The old scheme stored a fixed 512 points per source, so resolution fell as
// duration rose: a 5.8-minute file got 677ms per point, and a two-second fragment
// of it resolved to two points. Peaks are stored per *second* here instead, so a
// fragment looks the same whether it was cut from a short take or a long one.
//
// Stored as min/max pairs rather than absolute magnitude. Real waveforms are not
// symmetric about zero, and `Math.abs` throws away half the shape.
//
// Host-agnostic: takes and returns bytes, so the renderer (which decodes through
// the browser) and the Node batch pass can both produce and read the same file.

/** Points per second of audio. At 200 each point spans 5ms. */
export const PEAKS_PER_SECOND = 200;

const MAGIC = "FRWV";
const VERSION = 1;
/** 16 bytes keeps the Int16 body two-byte aligned. */
const HEADER_BYTES = 16;
const INT16_MAX = 32767;

export type WaveformPeaks = {
  peaksPerSecond: number;
  /** The rate the audio was decoded at. Informational; peak timing derives from `peaksPerSecond`. */
  sampleRate: number;
  /** Interleaved min, max per point, each scaled to Int16. */
  pairs: Int16Array;
};

export type PeakRange = {
  min: Float32Array;
  max: Float32Array;
};

function clampToInt16(value: number) {
  const scaled = Math.round(value * INT16_MAX);
  return scaled > INT16_MAX ? INT16_MAX : scaled < -INT16_MAX ? -INT16_MAX : scaled;
}

/**
 * Reduces a signal to min/max pairs.
 *
 * Every input sample is examined — this is a summary, so skipping samples would
 * miss the transients that make a waveform legible.
 */
export function computePeaks(
  signal: Float32Array,
  sampleRate: number,
  peaksPerSecond: number = PEAKS_PER_SECOND,
): WaveformPeaks {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("sampleRate must be positive");
  if (!Number.isFinite(peaksPerSecond) || peaksPerSecond <= 0) {
    throw new Error("peaksPerSecond must be positive");
  }
  // No real audio is sampled below telephone rates, and accepting one that claims to
  // be asks for a point per fraction of a sample. A metadata bug once reported 2Hz
  // for a 44.1kHz file, which sized the output at 1.5 billion points and got the
  // process killed with no error to read. Refusing is far easier to diagnose.
  if (sampleRate < 1000) {
    throw new Error(`sampleRate ${sampleRate} is too low to be real audio`);
  }

  const samplesPerPoint = sampleRate / peaksPerSecond;
  const points = Math.max(1, Math.ceil(signal.length / samplesPerPoint));
  const pairs = new Int16Array(points * 2);

  for (let point = 0; point < points; point++) {
    const start = Math.floor(point * samplesPerPoint);
    const end = Math.min(signal.length, Math.floor((point + 1) * samplesPerPoint));

    if (start >= end) continue; // leaves the pair at 0/0: genuinely no samples

    let min = signal[start];
    let max = signal[start];
    for (let sample = start + 1; sample < end; sample++) {
      const value = signal[sample];
      if (value < min) min = value;
      if (value > max) max = value;
    }

    pairs[point * 2] = clampToInt16(min);
    pairs[point * 2 + 1] = clampToInt16(max);
  }

  return { peaksPerSecond, sampleRate, pairs };
}

export function encodeWaveform(waveform: WaveformPeaks): Uint8Array {
  const points = waveform.pairs.length / 2;
  const bytes = new Uint8Array(HEADER_BYTES + waveform.pairs.byteLength);
  const view = new DataView(bytes.buffer);

  for (let i = 0; i < MAGIC.length; i++) bytes[i] = MAGIC.charCodeAt(i);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, waveform.peaksPerSecond, true);
  view.setUint32(8, points, true);
  view.setUint32(12, waveform.sampleRate, true);
  new Int16Array(bytes.buffer, HEADER_BYTES, waveform.pairs.length).set(waveform.pairs);

  return bytes;
}

export function decodeWaveform(bytes: Uint8Array): WaveformPeaks {
  if (bytes.length < HEADER_BYTES) throw new Error("waveform file is too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== MAGIC) throw new Error(`not a waveform file (magic ${JSON.stringify(magic)})`);

  const version = view.getUint16(4, true);
  if (version !== VERSION) throw new Error(`unsupported waveform version ${version}`);

  const peaksPerSecond = view.getUint16(6, true);
  const points = view.getUint32(8, true);
  const sampleRate = view.getUint32(12, true);

  const available = Math.floor((bytes.length - HEADER_BYTES) / 4);
  // Trust the file over the header, as with truncated WAVs.
  const usable = Math.min(points, available);
  const pairs = new Int16Array(usable * 2);
  for (let i = 0; i < usable * 2; i++) {
    pairs[i] = view.getInt16(HEADER_BYTES + i * 2, true);
  }

  return { peaksPerSecond, sampleRate, pairs };
}

/**
 * Extracts a time range and reduces it to `points` columns.
 *
 * Reduction is max-pooling of the extremes rather than averaging: averaging peaks
 * flattens transients, so a drum hit would fade as you zoomed out. Asking for more
 * points than the range holds returns what the range holds — it does not
 * interpolate detail that was never measured.
 */
export function peaksForRange(
  waveform: WaveformPeaks,
  startSeconds: number,
  endSeconds: number,
  points: number,
): PeakRange {
  const total = waveform.pairs.length / 2;
  const first = Math.max(0, Math.floor(startSeconds * waveform.peaksPerSecond));
  const last = Math.min(total, Math.max(first + 1, Math.ceil(endSeconds * waveform.peaksPerSecond)));
  const span = last - first;

  const columns = Math.max(1, Math.min(points, span));
  const min = new Float32Array(columns);
  const max = new Float32Array(columns);
  const perColumn = span / columns;

  for (let column = 0; column < columns; column++) {
    const from = first + Math.floor(column * perColumn);
    const to = Math.min(last, Math.max(from + 1, first + Math.floor((column + 1) * perColumn)));

    let low = 0;
    let high = 0;
    for (let point = from; point < to; point++) {
      const pairMin = waveform.pairs[point * 2] / INT16_MAX;
      const pairMax = waveform.pairs[point * 2 + 1] / INT16_MAX;
      if (pairMin < low) low = pairMin;
      if (pairMax > high) high = pairMax;
    }

    min[column] = low;
    max[column] = high;
  }

  return { min, max };
}

/**
 * Collapses a range to the 0–100 magnitudes the current waveform components draw.
 *
 * A bridge, not the destination: the file keeps min and max so the renderer can be
 * upgraded to draw true asymmetric waveforms without regenerating anything. Note
 * there is no floor applied — silence reads as 0, where the previous
 * implementation drew it as 4 and made digital black look like faint noise.
 */
export function magnitudes(range: PeakRange): number[] {
  const values: number[] = [];
  for (let i = 0; i < range.max.length; i++) {
    const extent = Math.max(Math.abs(range.min[i]), Math.abs(range.max[i]));
    values.push(Math.round(extent * 100));
  }
  return values;
}
