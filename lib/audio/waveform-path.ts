export const WAVEFORM_VERTICAL_FILL = 0.98;

export function waveformPath(values: number[], width = 1000, height = 160) {
  const middle = height / 2;
  const amplitude = middle * WAVEFORM_VERTICAL_FILL;
  const upper = values
    .map(
      (value, index) =>
        `${index ? "L" : "M"}${(index / Math.max(1, values.length - 1)) * width},${middle - (value / 100) * amplitude}`,
    )
    .join(" ");
  const lower = [...values]
    .reverse()
    .map((value, reverseIndex) => {
      const index = values.length - 1 - reverseIndex;
      return `L${(index / Math.max(1, values.length - 1)) * width},${middle + (value / 100) * amplitude}`;
    })
    .join(" ");
  return `${upper} ${lower} Z`;
}
