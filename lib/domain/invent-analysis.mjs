const KEYS = ["C", "D", "E", "F", "G", "A", "B"];

function hashSeed(input) {
  let seed = 0;
  for (const char of String(input)) {
    seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  }
  return seed;
}

/** Deterministic placeholder analysis when measured values are missing. */
export function inventAnalysis(sourceId) {
  const seed = hashSeed(sourceId);
  return {
    bpm: 72 + (seed % 56),
    key: KEYS[seed % KEYS.length],
    scale: seed % 2 === 0 ? "major" : "minor",
    keyStrength: 55 + (seed % 35),
  };
}

export function analysisNeedsInvention(analysis) {
  if (!analysis || typeof analysis !== "object") return true;
  return analysis.bpm == null && analysis.key == null;
}
