import { cn } from "@/lib/utils";

/** The 12 chroma bins, in the order essentia emits them: bin 0 is A. */
export const PITCH_CLASS_NAMES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];

/**
 * The pitch class a chroma vector leans on hardest, or `null` when it leans on
 * nothing — an all-zero vector is what unpitched audio measures, and calling its
 * first bin the strongest would invent a tonal centre.
 */
export function strongestPitchClassIndex(chroma: number[] | null | undefined): number | null {
  if (!chroma?.length) return null;
  const peak = Math.max(...chroma);
  if (!(peak > 0)) return null;
  return chroma.indexOf(peak);
}

export function strongestPitchClass(chroma: number[] | null | undefined): string | null {
  const index = strongestPitchClassIndex(chroma);
  return index === null ? null : PITCH_CLASS_NAMES[index] ?? null;
}

/**
 * The chroma vector as twelve bars.
 *
 * Unlabelled on purpose: at this size the numbers would be unreadable and the
 * shape is the point — which pitch classes something leans on, and whether it
 * leans at all. Heights are relative to the strongest bin, so this shows the
 * balance between pitch classes and not how loud the audio was.
 */
export function ChromaSparkline({
  chroma,
  className,
}: {
  chroma: number[];
  className?: string;
}) {
  const peak = Math.max(...chroma);
  if (!(peak > 0)) return null;

  const strongest = strongestPitchClass(chroma) ?? "—";

  return (
    <span
      className={cn("chroma-sparkline", className)}
      role="img"
      aria-label={`Pitch class balance, strongest ${strongest}`}
      title={chroma
        .map((value, index) => `${PITCH_CLASS_NAMES[index]} ${Math.round((value / peak) * 100)}%`)
        .join("  ")}
    >
      {chroma.map((value, index) => (
        <span
          key={PITCH_CLASS_NAMES[index]}
          className="chroma-sparkline-bar"
          style={{ height: `${(value / peak) * 100}%` }}
        />
      ))}
    </span>
  );
}
