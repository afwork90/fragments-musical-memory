// What the Fracture map plots. A source and a fragment are the same kind of thing
// here — both are audio, both are measured, both are playable.

import type { MeasuredSummary } from "../view/analysis";

export type MapAsset = {
  /**
   * A `PreviewScope` id: a fragment id, or `source:<id>`. Playback keys on this,
   * never on a fragment id, which is what lets one selection mean either.
   */
  id: string;
  label: string;
  /**
   * Only ever used to pick a `PreviewScope` builder. It must not affect position
   * or appearance: this map treats sources and fragments without distinction.
   */
  kind: "source" | "fragment";
  analysis: MeasuredSummary;
  /**
   * Seconds. Carried for labelling only. Deliberately not a feature — how long a
   * fragment is is not a property of how it sounds.
   */
  duration: number;
};
