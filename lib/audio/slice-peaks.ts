export function slicePeaks(
  peaks: number[],
  start: number,
  end: number,
  totalDuration: number,
  minPoints = 6,
) {
  if (!peaks.length || totalDuration <= 0 || end <= start) return peaks;

  const startIndex = Math.floor((start / totalDuration) * peaks.length);
  const endIndex = Math.max(startIndex + 1, Math.ceil((end / totalDuration) * peaks.length));
  const slice = peaks.slice(startIndex, endIndex);

  return slice.length >= minPoints ? slice : peaks;
}
