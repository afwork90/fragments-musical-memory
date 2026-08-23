export function parseMusicalKeyLabel(label: string | undefined | null): { key: string | null; scale: string | null } {
  if (!label || label === "—") return { key: null, scale: null };
  const match = label.match(/^(.+?)\s+(major|minor|dorian|mixolydian|lydian|phrygian|locrian|aeolian|ionian)$/i);
  if (match) return { key: match[1].trim(), scale: match[2].toLowerCase() };
  return { key: label, scale: null };
}

export function formatMusicalKey(key: string | null | undefined, scale: string | null | undefined) {
  if (!key) return null;
  return scale ? `${key} ${scale}` : key;
}

/** Prefer primary analysis fields, then fall back (e.g. fragment → source). */
export function resolvedMusicalKey(
  primary?: { key?: string | null; scale?: string | null } | null,
  fallback?: { key?: string | null; scale?: string | null } | null,
) {
  const key = primary?.key?.trim() || fallback?.key?.trim() || null;
  const scale = primary?.scale?.trim() || fallback?.scale?.trim() || null;
  return formatMusicalKey(key, scale);
}

/** Persisted source.json analysis wins over quick preview analysis from the audio cache. */
export function resolvedSourceAnalysis(
  source: { bpm?: number | null; key?: string | null; scale?: string | null },
  cached?: { analysis: { bpm?: number | null; key?: string | null; scale?: string | null; keyStrength?: number | null } } | null,
) {
  return {
    bpm: source.bpm ?? cached?.analysis.bpm ?? null,
    key: source.key ?? cached?.analysis.key ?? null,
    scale: source.scale ?? cached?.analysis.scale ?? null,
    keyStrength: cached?.analysis.keyStrength ?? null,
  };
}

/** Case/spacing-insensitive key label for filter matching. */
export function normalizeKeyLabel(label: string | null | undefined) {
  if (!label) return "";
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Display labels for a source.json-style analysis record. */
export function sourceKeyLabels(source: { key?: string | null; scale?: string | null } | null | undefined) {
  if (!source) return [] as string[];
  const labels: string[] = [];
  const formatted = formatMusicalKey(source.key, source.scale);
  if (formatted) labels.push(formatted);
  else if (source.key) labels.push(source.key);
  return labels;
}

export function fragmentKeyLabels(
  fragment: { key?: string | null; alternateKeys?: string[] },
  source?: { key?: string | null; scale?: string | null } | null,
) {
  // Filter identity is the analysis key only — never relative/alternate keys.
  const fromSource = sourceKeyLabels(source);
  if (fromSource.length) return fromSource;
  if (fragment.key && fragment.key !== "—") return [fragment.key];
  return [];
}

export function matchesKeySelection(candidates: string[], selected: string[]) {
  if (!selected.length) return true;
  if (!candidates.length) return false;
  const wanted = new Set(selected.map(normalizeKeyLabel).filter(Boolean));
  return candidates.some((candidate) => wanted.has(normalizeKeyLabel(candidate)));
}

/** Prefer a stable display label when the same key appears with different casing. */
export function uniqueKeyLabels(labels: string[]) {
  const byNormalized = new Map<string, string>();
  for (const label of labels) {
    const normalized = normalizeKeyLabel(label);
    if (!normalized || normalized === "—") continue;
    if (!byNormalized.has(normalized)) byNormalized.set(normalized, label);
  }
  return [...byNormalized.values()].sort((a, b) => a.localeCompare(b));
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
