/**
 * Extracts the peaks covering one time range of a source.
 *
 * This used to return the *entire* source's peaks whenever the slice came out
 * under six points, which meant a two-second fragment of a six-minute recording
 * drew the whole six minutes — the wrong audio, not merely a coarse picture of the
 * right audio. It now returns what the range actually covers, however little that
 * is. With the cache holding peaks at a fixed rate per second rather than a fixed
 * count per file, short ranges have real detail to return.
 */
export function slicePeaks(
  peaks: number[],
  start: number,
  end: number,
  totalDuration: number,
) {
  if (!peaks.length || totalDuration <= 0 || end <= start) return peaks;

  const startIndex = Math.min(peaks.length - 1, Math.max(0, Math.floor((start / totalDuration) * peaks.length)));
  const endIndex = Math.min(peaks.length, Math.max(startIndex + 1, Math.ceil((end / totalDuration) * peaks.length)));

  return peaks.slice(startIndex, endIndex);
}
