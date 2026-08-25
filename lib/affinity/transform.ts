// What has to happen to a candidate fragment for it to sit with an anchor.
//
// Pure and dually compiled like the rest of `lib/affinity/`: relative
// extensionless imports, no `node:*`, no DOM.
//
// Every field is nullable, for the same reason the metric axes are. Twelve of the
// library's 26 fragments report a plausible BPM at zero confidence, so for most
// pairs "match the tempo" has no answer — and a ratio invented for them would
// stretch real audio to a number nothing measured. `null` here means the UI shows
// "not measurable" and no DSP runs, which is the only honest outcome.

import { MIN_BPM_CONFIDENCE } from "../analysis/features";
import { MIN_KEY_STRENGTH, pitchClassOf } from "./compare";

/**
 * The measured fields a match needs.
 *
 * Structural on purpose: both `MeasuredAnalysis` (on disk) and `MeasuredSummary`
 * (what a component renders) satisfy it, so the same function serves the batch
 * scripts and the UI without either shape being converted to the other.
 */
export type MatchInput = {
  bpm: number | null;
  bpmConfidence?: number | null;
  key: string | null;
  scale: string | null;
  keyStrength?: number | null;
};

/**
 * How the candidate's pulse is being read against the anchor's. `"double-time"`
 * means the candidate is counted at twice its measured tempo to line up — the
 * relationship `tempoSimilarity` already treats as a match rather than a miss.
 */
export type MatchTiming = "normal" | "half-time" | "double-time";

export type MatchTransform = {
  /**
   * What to multiply the candidate's speed by: an `<audio>` element's
   * `playbackRate` and SoundTouch's `tempo` are both exactly this number.
   *
   * Always within about 0.71 to 1.41, because half and double time are folded out
   * first. A pair three octaves apart in tempo is matched by reinterpreting the
   * pulse, not by stretching audio to a third of its length.
   */
  tempoRatio: number | null;
  /** The candidate's own measured tempo, or `null` when it was not trustworthy. */
  fromBpm: number | null;
  /** The tempo the candidate ends up playing at once `tempoRatio` is applied. */
  matchedBpm: number | null;
  timing: MatchTiming;
  /**
   * Semitones to shift the candidate by, -6 to 6, or `null` when either key is
   * missing or was measured too weakly to act on.
   *
   * The shortest chromatic path, not the distance on the circle of fifths that
   * `pitchSimilarity` scores: a fifth is a *near* relationship but shifting by
   * seven semitones is a bigger move than shifting down five.
   */
  semitones: number | null;
  /**
   * Whether the two agree on major or minor, or `null` when no key comparison was
   * possible. Worth surfacing because a shift aligns roots and can do nothing
   * about a mode clash.
   */
  sameScale: boolean | null;
};

/**
 * Pulse reinterpretations worth trying. Mirrors `TEMPO_RATIOS` in `compare.ts`,
 * because the axis that scores a pair and the transform that adapts it must agree
 * about what counts as the same *pulse* — a 70 and a 140 are one tempo counted two
 * ways, and essentia octave-errors in exactly this direction.
 */
const TEMPO_INTERPRETATIONS: { multiplier: number; timing: MatchTiming }[] = [
  { multiplier: 1, timing: "normal" },
  { multiplier: 2, timing: "double-time" },
  { multiplier: 0.5, timing: "half-time" },
];

/** A tempo change smaller than this is not worth calling a change. */
const TEMPO_DEADBAND = 0.005;

/**
 * The most a tempo will be stretched to make a match: a quarter faster or slower.
 *
 * A quality bound, not a similarity one. `TEMPO_TOLERANCE` in `compare.ts` is
 * deliberately not reused — that asks whether two fragments are already at the same
 * tempo, and requiring that before offering to close the gap would be circular.
 * What matters here is where a stretch stops sounding like the same performance.
 *
 * The library has exactly two pairs with a trustworthy tempo at both ends, and they
 * sit either side of this: 101 against 120 BPM is a 19% stretch and is offered, 101
 * against 140 is 39% and is not. Beyond about a quarter the stretch is audible as
 * processing rather than as tempo.
 *
 * A pair outside it keeps its Target BPM field. Stretching anyway is a choice
 * someone can make; it is just not made on their behalf.
 */
const MAX_STRETCH = 1.25;

export function matchTransform(anchor: MatchInput, candidate: MatchInput): MatchTransform {
  const anchorBpm = trustedBpm(anchor);
  const candidateBpm = trustedBpm(candidate);

  let tempoRatio: number | null = null;
  let matchedBpm: number | null = null;
  let timing: MatchTiming = "normal";

  if (anchorBpm !== null && candidateBpm !== null) {
    let best = { ratio: 1, timing: "normal" as MatchTiming, distance: Infinity };
    for (const { multiplier, timing: candidateTiming } of TEMPO_INTERPRETATIONS) {
      const ratio = anchorBpm / (candidateBpm * multiplier);
      // In octaves, so speeding up by a third and slowing by a third are the same
      // distance. Measured as a plain difference they are not, and the choice
      // between two interpretations would favour slowing down.
      const distance = Math.abs(Math.log2(ratio));
      if (distance < best.distance) best = { ratio, timing: candidateTiming, distance };
    }
    if (best.ratio <= MAX_STRETCH && best.ratio >= 1 / MAX_STRETCH) {
      tempoRatio = round(best.ratio, 4);
      timing = best.timing;
      matchedBpm = round(candidateBpm * tempoRatio, 1);
    }
  }

  return {
    tempoRatio,
    fromBpm: candidateBpm,
    matchedBpm,
    timing,
    semitones: semitonesBetween(anchor, candidate),
    sameScale: scaleAgreement(anchor, candidate),
  };
}

/** Chips for the candidate bar: only what the transform actually establishes. */
export function describeMatch(transform: MatchTransform): string[] {
  const labels: string[] = [];

  if (transform.timing === "half-time") labels.push("½ time");
  if (transform.timing === "double-time") labels.push("2× time");

  if (transform.tempoRatio !== null && Math.abs(transform.tempoRatio - 1) >= TEMPO_DEADBAND) {
    const delta = Math.round((transform.matchedBpm ?? 0) - (transform.fromBpm ?? 0));
    if (delta !== 0) labels.push(`${signed(delta)} BPM`);
  }

  if (transform.semitones !== null && transform.semitones !== 0) {
    labels.push(`${signed(transform.semitones)} st`);
  }

  return labels;
}

/** Whether applying this transform changes the audio at all. */
export function isAudibleTransform(tempoRatio: number, semitones: number): boolean {
  return Math.abs(tempoRatio - 1) >= TEMPO_DEADBAND || semitones !== 0;
}

/**
 * The filename a rendered match is cached under.
 *
 * Deterministic and legible rather than hashed, so a stray file in `renders/` can
 * be read: fragment, the slice it came from in milliseconds, the tempo ratio in
 * parts per thousand, the pitch shift in tenths of a semitone. `RENDER_VERSION`
 * is what invalidates every render when the DSP changes — mtimes cannot, since the
 * inputs are unchanged.
 */
export const RENDER_VERSION = 1;

export function renderFileName(
  fragmentId: string,
  start: number,
  end: number,
  tempoRatio: number,
  semitones: number,
): string {
  const parts = [
    fragmentId.replace(/[^A-Za-z0-9._-]/g, ""),
    `${Math.round(start * 1000)}-${Math.round(end * 1000)}`,
    `t${Math.round(tempoRatio * 1000)}`,
    `p${Math.round(semitones * 10)}`,
    `v${RENDER_VERSION}`,
  ];
  return `${parts.join("_")}.wav`;
}

function trustedBpm(input: MatchInput): number | null {
  if (input.bpm === null || !(input.bpm > 0)) return null;
  if ((input.bpmConfidence ?? 0) < MIN_BPM_CONFIDENCE) return null;
  return input.bpm;
}

function usableKey(input: MatchInput): number | null {
  if ((input.keyStrength ?? 0) < MIN_KEY_STRENGTH) return null;
  return pitchClassOf(input.key);
}

function semitonesBetween(anchor: MatchInput, candidate: MatchInput): number | null {
  const to = usableKey(anchor);
  const from = usableKey(candidate);
  if (to === null || from === null) return null;

  const up = (to - from + 12) % 12;
  return up > 6 ? up - 12 : up;
}

function scaleAgreement(anchor: MatchInput, candidate: MatchInput): boolean | null {
  if (usableKey(anchor) === null || usableKey(candidate) === null) return null;
  if (!anchor.scale || !candidate.scale) return null;
  return anchor.scale === candidate.scale;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
