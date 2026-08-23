export function parseMusicalKeyLabel(label: string | undefined | null): { key: string | null; scale: string | null } {
  if (!label || label === "—") return { key: null, scale: null };
  const match = label.match(/^(.+?)\s+(major|minor)$/i);
  if (match) return { key: match[1].trim(), scale: match[2].toLowerCase() };
  return { key: label, scale: null };
}

export function formatMusicalKey(key: string | null | undefined, scale: string | null | undefined) {
  if (!key) return null;
  return scale ? `${key} ${scale}` : key;
}

const KEYS = ["C", "D", "E", "F", "G", "A", "B"];

function hashSeed(input: string) {
  let seed = 0;
  for (const char of input) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  return seed;
}

export function inventAnalysis(sourceId: string) {
  const seed = hashSeed(sourceId);
  return {
    bpm: 72 + (seed % 56),
    key: KEYS[seed % KEYS.length],
    scale: seed % 2 === 0 ? "major" : "minor",
    keyStrength: 55 + (seed % 35),
  };
}

export function analysisNeedsInvention(
  analysis: { bpm?: number | null; key?: string | null } | null | undefined,
) {
  if (!analysis) return true;
  return analysis.bpm == null && analysis.key == null;
}
