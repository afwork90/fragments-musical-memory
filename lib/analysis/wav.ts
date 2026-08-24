// Decoding a WAV to a mono Float32Array.
//
// Host-agnostic on purpose: it takes bytes, so the Electron main process, a Node
// batch script, and the renderer can all use it. No `node:*` and no DOM, which
// rules out Buffer — hence DataView.
//
// Only linear PCM is handled. That covers the library (16-bit mono 22.05kHz and
// 24-bit stereo 48kHz both appear), and anything else throws rather than
// producing plausible-looking noise.

export type DecodedAudio = {
  /** Mono, channels averaged, samples in [-1, 1]. */
  signal: Float32Array;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
};

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function ascii(bytes: Uint8Array, at: number) {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

/**
 * Reads a signed little-endian integer of 2, 3, or 4 bytes.
 *
 * 24-bit needs doing by hand: there is no `getInt24`, and the sign bit has to be
 * carried up before being shifted back down.
 */
function readSample(view: DataView, at: number, bytes: number) {
  if (bytes === 2) return view.getInt16(at, true);
  if (bytes === 4) return view.getInt32(at, true);
  const lo = view.getUint8(at);
  const mid = view.getUint8(at + 1);
  const hi = view.getUint8(at + 2);
  return (lo | (mid << 8) | (hi << 24)) >> 8;
}

export function decodeWav(bytes: Uint8Array): DecodedAudio {
  if (bytes.length < 44) throw new Error("not a WAV file: too short");
  if (ascii(bytes, 0) !== "RIFF" || ascii(bytes, 8) !== "WAVE") {
    throw new Error("not a WAV file: missing RIFF/WAVE");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataLength = 0;

  // Chunks must be walked, not assumed: real recorders emit `bext`, `junk`, and
  // `LIST` chunks before `data`, and one of the library's files does exactly that.
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === "fmt " && size >= 16) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataStart = body;
      // Trust the file's length over the header: truncated recordings are common.
      dataLength = Math.min(size, bytes.length - body);
      break;
    }

    if (size === 0) break;
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  if (!channels || !sampleRate || !bitsPerSample) throw new Error("WAV has no readable fmt chunk");
  if (dataStart < 0) throw new Error("WAV has no data chunk");
  if (format !== WAVE_FORMAT_PCM && format !== WAVE_FORMAT_EXTENSIBLE) {
    throw new Error(`unsupported WAV format ${format}; only linear PCM is handled`);
  }

  const bytesPerSample = bitsPerSample / 8;
  if (![2, 3, 4].includes(bytesPerSample)) {
    throw new Error(`unsupported bit depth ${bitsPerSample}; only 16, 24, and 32-bit PCM are handled`);
  }

  const frameBytes = bytesPerSample * channels;
  const frames = Math.floor(dataLength / frameBytes);
  const signal = new Float32Array(frames);
  const scale = 1 / 2 ** (bitsPerSample - 1);

  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    const base = dataStart + frame * frameBytes;
    for (let channel = 0; channel < channels; channel++) {
      sum += readSample(view, base + channel * bytesPerSample, bytesPerSample) * scale;
    }
    signal[frame] = sum / channels;
  }

  return { signal, sampleRate, channels, bitsPerSample };
}
