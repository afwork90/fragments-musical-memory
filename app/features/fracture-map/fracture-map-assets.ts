// Everything the Fracture map plots, from the abstractions the app already keeps.
//
// This is the one module that knows the seed data exists. When it is retired, the
// `seedAnalysis` parameter and its one lookup go with it and nothing else changes.

import { collapseWholeTakes, type PlacedAsset } from "@/lib/map/collapse";
import type { MeasuredSummary } from "@/lib/view/analysis";
import type { Fragment } from "@/lib/view/fragment";
import type { SourceFile } from "@/lib/view/source-file";

export { WHOLE_TAKE_RATIO } from "@/lib/map/collapse";

export function collectMapAssets(
  sources: SourceFile[],
  fragments: Fragment[],
  seedAnalysis: Record<string, MeasuredSummary>,
): PlacedAsset[] {
  const assets: PlacedAsset[] = [];

  for (const source of sources) {
    if (!source.measured) continue;
    assets.push({
      // The `source:` prefix is what `buildSourcePreviewScope` returns, so one
      // selection can mean either a slice or a whole recording.
      id: `source:${source.id}`,
      sourceId: source.id,
      label: source.name,
      kind: "source",
      analysis: source.measured,
      duration: source.duration,
    });
  }

  for (const fragment of fragments) {
    // Disk beats the seed table: a real measurement is never overridden by one.
    const analysis = fragment.measured ?? seedAnalysis[fragment.id];
    if (!analysis) continue;
    assets.push({
      id: fragment.id,
      sourceId: fragment.sourceId,
      label: fragment.name,
      kind: "fragment",
      analysis,
      duration: fragment.end - fragment.start,
    });
  }

  return collapseWholeTakes(assets);
}
