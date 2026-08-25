// Bringing every source to one sample rate before feature extraction.
//
// This is not a nicety. Mel filterbanks and chroma bins are both defined in terms
// of the sample rate, so the same audio at 48kHz and at 22.05kHz produces
// different MFCC and HPCP numbers. Comparing features across a library that mixes
// rates — as this one does — silently compares nonsense unless they are
// normalised first.

/**
 * The rate features are computed at. 22.05kHz keeps everything up to ~11kHz,
 * which is well above where timbre and pitch information lives, and matches the
 * majority of the library so most files need no work at all.
 */
export const FEATURE_SAMPLE_RATE = 22050;

/**
 * Box-averaging: each output sample is the mean of the input samples it spans.
 *
 * Not a polyphase filter, and it is only used for downsampling, where averaging
 * across the window also suppresses most of the aliasing that plain decimation
 * would fold back. For MFCC, chroma, onsets, and tempo that is sufficient, and it
 * avoids essentia's own Resample, which allocates on top of its input and aborts
 * the WASM heap on a long 48kHz signal.
 */
export function resample(signal: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return signal;
  if (from <= 0 || to <= 0) throw new Error("sample rates must be positive");

  const ratio = from / to;
  const length = Math.floor(signal.length / ratio);
  const out = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const start = i * ratio;
    const end = Math.min(signal.length, start + ratio);
    let sum = 0;
    let count = 0;
    for (let j = Math.floor(start); j < end; j++) {
      sum += signal[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : 0;
  }

  return out;
}
