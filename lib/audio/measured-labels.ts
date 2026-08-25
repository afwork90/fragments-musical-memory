// How a measured characteristic reads to a person.
//
// The Info panel and the Sources table both show these numbers, so they are
// formatted once here: a value that rounds one way in a table and another way in
// a panel is the same class of bug as a fragment whose key disagreed between its
// card and the transform console, and it is found the same way — by noticing two
// views of one thing contradicting each other.
//
// Absent is "—", never a zero. Labels say what the number means rather than which
// algorithm produced it, and the hints are the sentence that explains it wherever
// it appears.

/** Spectral centroid: where the energy sits, which is heard as brightness. */
export function brightnessLabel(centroidHz: number | null | undefined): string {
  if (typeof centroidHz !== "number") return "—";
  return `${Math.round(centroidHz)} Hz`;
}

/** Dynamic complexity: how much the level moves over the performance. */
export function dynamicsLabel(dynamicComplexity: number | null | undefined): string {
  if (typeof dynamicComplexity !== "number") return "—";
  return `${dynamicComplexity.toFixed(1)} dB`;
}

/** Essentia's intensity is -1, 0 or 1; the numbers mean nothing to a reader. */
export function intensityLabel(intensity: number | null | undefined): string {
  if (typeof intensity !== "number") return "—";
  if (intensity < 0) return "Relaxed";
  return intensity > 0 ? "Aggressive" : "Moderate";
}

/**
 * The three readings in the order they are felt, which is what the filter pills
 * offer and what sorting by intensity means.
 */
export const INTENSITY_LABELS = ["Relaxed", "Moderate", "Aggressive"];

export const MEASURED_HINTS = {
  brightness: "Spectral centroid: where the energy sits.",
  dynamics:
    "Dynamic complexity: how much the level moves. A steady loop is low; a performance that breathes is high.",
  intensity: "How hard the performance pushes: relaxed, moderate or aggressive.",
  chroma:
    "Which pitch classes this leans on, octaves collapsed. Hover for the balance.",
};
