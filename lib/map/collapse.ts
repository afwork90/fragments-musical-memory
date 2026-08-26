// Which of a source's points survive.
//
// This map treats a source and a fragment as the same kind of thing, which makes
// a fragment spanning its whole take a duplicate of its source rather than a
// child of it: the same audio, so the same measurements, so the same position.

import type { MapAsset } from "./asset";

/** How much of a source a fragment must cover to *be* that source. */
export const WHOLE_TAKE_RATIO = 0.98;

/** A `MapAsset` plus the source it belongs to, which the collapse needs and the map does not. */
export type PlacedAsset = MapAsset & { sourceId: string };

export function collapseWholeTakes(assets: PlacedAsset[]): PlacedAsset[] {
  const covered = new Set<string>();

  for (const asset of assets) {
    if (asset.kind !== "fragment") continue;
    const source = assets.find((entry) => entry.kind === "source" && entry.sourceId === asset.sourceId);
    // A zero-length source cannot be covered — the ratio would be a division by
    // zero, and a NaN comparison quietly answering "no" is not a decision.
    if (!source || source.duration <= 0) continue;
    if (asset.duration / source.duration >= WHOLE_TAKE_RATIO) covered.add(source.id);
  }

  return assets.filter((asset) => !covered.has(asset.id));
}
