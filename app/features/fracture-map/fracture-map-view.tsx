"use client";

import { useMemo, type ReactNode } from "react";

import { collectMapAssets } from "./fracture-map-assets";
import { MAP_WORLD } from "@/app/map-layout.mjs";
import { strongestPitchClassIndex } from "@/lib/audio/chroma-sparkline";
import { DIMENSIONS, rawVector } from "@/lib/map/feature-vector";
import { buildFeatureMatrix } from "@/lib/map/matrix";
import { fitProjection, projectAll, topLoadings } from "@/lib/map/projection";
import { spreadPoints } from "@/lib/map/spread";
import type { MeasuredSummary } from "@/lib/view/analysis";
import type { Fragment } from "@/lib/view/fragment";
import type { SourceFile } from "@/lib/view/source-file";

type FractureMapViewProps = {
  sources: SourceFile[];
  fragments: Fragment[];
  seedAnalysis: Record<string, MeasuredSummary>;
  selectedId: string | null;
  onSelect: (assetId: string) => void;
  /** The card for the selected asset, supplied by the app so playback stays in one place. */
  inspector: ReactNode;
};

/**
 * Above this share of absent dimensions, a point is drawn faded.
 *
 * A quarter, not a half: on the current library the worst asset is missing one
 * dimension of 32, so a half would never fire and the legend would describe
 * something that does not happen.
 */
const MOSTLY_IMPUTED = 0.25;

export function FractureMapView({ sources, fragments, seedAnalysis, selectedId, onSelect, inspector }: FractureMapViewProps) {
  const layout = useMemo(() => {
    const assets = collectMapAssets(sources, fragments, seedAnalysis);
    if (assets.length === 0) return null;

    const matrix = buildFeatureMatrix(assets.map((asset) => rawVector(asset.analysis)));
    const basis = fitProjection(matrix.rows, 2);
    const points = spreadPoints(
      projectAll(matrix.rows, basis),
      assets.map((asset) => asset.id),
      MAP_WORLD,
    );

    return {
      nodes: assets.map((asset, index) => ({
        id: asset.id,
        label: asset.label,
        point: points[index],
        pitchClass: strongestPitchClassIndex(asset.analysis.chroma),
        unsettled: matrix.imputed[index] / DIMENSIONS.length > MOSTLY_IMPUTED,
      })),
      // Named after what actually drives each axis, so the caption cannot claim a
      // meaning the projection does not have.
      captions: [0, 1].map((component) => topLoadings(basis, matrix.dimensions, component, 2)
        .map((loading) => loading.name)
        .join(" · ")),
    };
  }, [sources, fragments, seedAnalysis]);

  const anyUnsettled = layout?.nodes.some((node) => node.unsettled) ?? false;

  return (
    <section className="page-view fracture-page">
      <div className="panel-titlebar fracture-heading">
        <div className="fracture-legend">
          <span>Position · what analysis measured</span>
          <span>Colour · the pitch class it leans on</span>
          {anyUnsettled ? <span>Faded · little was measurable</span> : null}
        </div>
      </div>

      <div className="fracture-board" role="region" aria-label="Fragments placed by measured character">
        {!layout
          ? <p className="fracture-empty">Nothing here has been measured yet. Once your audio is analysed, it will appear here arranged by how it sounds.</p>
          : <div className="fracture-canvas" style={{ aspectRatio: `${MAP_WORLD.width} / ${MAP_WORLD.height}` }}>
            <span className="fracture-axis fracture-axis-x">{layout.captions[0]}</span>
            <span className="fracture-axis fracture-axis-y">{layout.captions[1]}</span>

            {layout.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={`fracture-node${selectedId === node.id ? " is-selected" : ""}${node.unsettled ? " is-unsettled" : ""}${node.pitchClass === null ? " is-unpitched" : ""}`}
                style={{
                  left: `${(node.point.x / MAP_WORLD.width) * 100}%`,
                  top: `${(node.point.y / MAP_WORLD.height) * 100}%`,
                  // A hue per pitch class, set only when there is one. An asset
                  // with no chroma is coloured by `.is-unpitched` instead, because
                  // a default hue would be a claim about its harmony.
                  ...(node.pitchClass === null ? {} : { ["--fracture-hue" as string]: `${node.pitchClass * 30}deg` }),
                }}
                aria-pressed={selectedId === node.id}
                onClick={() => onSelect(node.id)}
              >
                <span className="fracture-node-dot" aria-hidden="true" />
                <span className="fracture-node-label">{node.label}</span>
              </button>
            ))}
          </div>}

        {selectedId && inspector ? <section className="fracture-inspector">{inspector}</section> : null}
      </div>
    </section>
  );
}
