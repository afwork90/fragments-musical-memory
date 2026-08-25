// Encoding channels of float samples as a 24-bit PCM WAV.
//
// Host-agnostic like the decoder beside it: it returns bytes, so the renderer can
// hand them to the main process to write and a Node script could write them
// directly. No `node:*`, no DOM, so no Buffer — hence DataView.
//
// 24-bit rather than 16-bit because these files are made to be dragged into a DAW
// and worked on further. A rendered match has already been through a decode, a
// resample-free time stretch, and a pitch shift; quantising to 16 bits at the end
// of that adds noise to material that may yet be processed again. The cost is 50%
// more bytes for a few seconds of audio, which is nothing next to the recordings
// they came from.

/** The smallest and largest values a signed 24-bit sample can hold. */
const PCM24_MAX = 8388607;
const PCM24_MIN = -8388608;

const BYTES_PER_SAMPLE = 3;
const HEADER_BYTES = 44;
const WAVE_FORMAT_PCM = 1;

function writeAscii(bytes: Uint8Array, at: number, text: string) {
  for (let index = 0; index < text.length; index++) bytes[at + index] = text.charCodeAt(index);
}

/**
 * Interleaves and encodes `channels`, which must be equal in length.
 *
 * Samples outside [-1, 1] are clamped rather than allowed to wrap. A time stretch
 * can overshoot slightly where partials line up, and wrapping turns that into a
 * click that sounds like a defect in the recording.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  if (channels.length === 0) throw new Error("encodeWav needs at least one channel");
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`encodeWav needs a positive sample rate, got ${sampleRate}`);
  }

  const frames = channels[0].length;
  for (const channel of channels) {
    if (channel.length !== frames) throw new Error("encodeWav needs channels of equal length");
  }

  const channelCount = channels.length;
  const dataBytes = frames * channelCount * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);

  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(bytes, 8, "WAVE");

  writeAscii(bytes, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, WAVE_FORMAT_PCM, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * BYTES_PER_SAMPLE, true);
  view.setUint16(32, channelCount * BYTES_PER_SAMPLE, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);

  writeAscii(bytes, 36, "data");
  view.setUint32(40, dataBytes, true);

  let at = HEADER_BYTES;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const sample = channels[channel][frame];
      // NaN can reach here from a stretch buffer that was never filled; silence is
      // the only safe reading of it.
      const scaled = Number.isFinite(sample) ? Math.round(sample * PCM24_MAX) : 0;
      const clamped = Math.max(PCM24_MIN, Math.min(PCM24_MAX, scaled));
      bytes[at] = clamped & 0xff;
      bytes[at + 1] = (clamped >> 8) & 0xff;
      bytes[at + 2] = (clamped >> 16) & 0xff;
      at += BYTES_PER_SAMPLE;
    }
  }

  return bytes;
}
