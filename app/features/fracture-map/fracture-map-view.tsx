"use client";

import { useMemo, type ReactNode } from "react";

import { collectMapAssets } from "./fracture-map-assets";
import { MAP_WORLD } from "@/app/map-layout.mjs";
import { clusterCountFor, clusterPoints, renumberByPosition } from "@/lib/map/cluster";
import { DIMENSIONS, rawVector } from "@/lib/map/feature-vector";
import { buildFeatureMatrix } from "@/lib/map/matrix";
import { explainedVariance, fitProjection, projectAll, topLoadings } from "@/lib/map/projection";
import { spreadPoints } from "@/lib/map/spread";
import { cellPath, voronoiCells } from "@/lib/map/voronoi.mjs";
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
  /** The graph/shatter toggle, which belongs to the Map page rather than to either view of it. */
  modeSwitch?: ReactNode;
};

/**
 * Above this share of absent dimensions, a point is drawn faded.
 *
 * A quarter, not a half: on the current library the worst asset is missing one
 * dimension of 32, so a half would never fire and the legend would describe
 * something that does not happen.
 */
const MOSTLY_IMPUTED = 0.25;

/**
 * Degrees of hue the cluster ramp spans.
 *
 * Short of a full circle on purpose: at 360 the first and last groups come back
 * round to the same red and read as one region.
 */
const HUE_SPAN = 280;

export function FractureMapView({ sources, fragments, seedAnalysis, selectedId, onSelect, inspector, modeSwitch }: FractureMapViewProps) {
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

    // Grouped on the same features the layout uses, so a cluster is a region of
    // the map rather than a scattering. Renumbered left to right so the hue ramp
    // reads as a progression instead of jumping about.
    const grouping = clusterPoints(matrix.rows, clusterCountFor(assets.length));
    const clusters = renumberByPosition(grouping.assignments, points, grouping.count);

    // One region per point, tiling the plot. The cell is the click target: a
    // 14px dot is a poor one, and the shards are the app's own metaphor.
    const cells = voronoiCells(points, MAP_WORLD);

    const variance = explainedVariance(basis);

    return {
      nodes: assets.map((asset, index) => ({
        id: asset.id,
        label: asset.label,
        point: points[index],
        cluster: clusters[index],
        cell: cellPath(cells[index]),
        unsettled: matrix.imputed[index] / DIMENSIONS.length > MOSTLY_IMPUTED,
      })),
      clusterCount: grouping.count,
      // Each axis is a weighted blend of every dimension, not one attribute, so
      // the caption says "mostly" and carries the share of variation it explains.
      // Naming only the top loadings would overstate what the axis is.
      captions: [0, 1].map((component) => ({
        drivers: topLoadings(basis, matrix.dimensions, component, 2)
          .map((loading) => loading.name)
          .join(" · "),
        share: Math.round((variance[component] ?? 0) * 100),
      })),
    };
  }, [sources, fragments, seedAnalysis]);

  const anyUnsettled = layout?.nodes.some((node) => node.unsettled) ?? false;
  const hueFor = (cluster: number, count: number) =>
    `${count <= 1 ? 0 : (cluster / (count - 1)) * HUE_SPAN}deg`;

  return (
    <section className="page-view fracture-page">
      <div className="panel-titlebar fracture-heading">
        <div className="fracture-legend">
          <span>Position · what analysis measured</span>
          <span>Colour · the group it measured into</span>
          {anyUnsettled ? <span>Faded · little was measurable</span> : null}
        </div>
        {modeSwitch}
      </div>

      {!layout
        ? <p className="fracture-empty">Nothing here has been measured yet. Once your audio is analysed, it will appear here arranged by how it sounds.</p>
        : <div className="fracture-plot" role="region" aria-label="Fragments placed by measured character">
          <span className="fracture-axis fracture-axis-y">
            mostly {layout.captions[1].drivers}
            <em> · {layout.captions[1].share}% of the variation</em>
          </span>

          {/* Held to the world's ratio: stretching to fit would scale x and y
              differently, which misstates the distances the map is about. */}
          <div className="fracture-canvas" style={{ aspectRatio: `${MAP_WORLD.width} / ${MAP_WORLD.height}` }}>
            {/* Drawn under a viewBox in the plot's own coordinates, so the cells
                track the canvas at any size without it having to be measured.
                Hidden from assistive tech because each cell duplicates the button
                below it, which is the focusable, labelled version of the same
                thing; this layer exists to give the mouse a large target. */}
            <svg
              className="fracture-cells"
              viewBox={`0 0 ${MAP_WORLD.width} ${MAP_WORLD.height}`}
              aria-hidden="true"
            >
              {layout.nodes.map((node) => (node.cell ? (
                <path
                  key={node.id}
                  d={node.cell}
                  className={`fracture-cell${selectedId === node.id ? " is-selected" : ""}${node.unsettled ? " is-unsettled" : ""}`}
                  style={{ ["--fracture-hue" as string]: hueFor(node.cluster, layout.clusterCount) }}
                  onClick={() => onSelect(node.id)}
                />
              ) : null))}
            </svg>

            {layout.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={`fracture-node${selectedId === node.id ? " is-selected" : ""}${node.unsettled ? " is-unsettled" : ""}`}
                style={{
                  left: `${(node.point.x / MAP_WORLD.width) * 100}%`,
                  top: `${(node.point.y / MAP_WORLD.height) * 100}%`,
                  ["--fracture-hue" as string]: hueFor(node.cluster, layout.clusterCount),
                }}
                aria-pressed={selectedId === node.id}
                onClick={() => onSelect(node.id)}
              >
                <span className="fracture-node-dot" aria-hidden="true" />
                <span className="fracture-node-label">{node.label}</span>
              </button>
            ))}
          </div>

          <span className="fracture-axis fracture-axis-x">
            mostly {layout.captions[0].drivers}
            <em> · {layout.captions[0].share}% of the variation</em>
          </span>
        </div>}

      {/* Always present, so selecting something does not resize the map under the cursor. */}
      <section className="fracture-inspector" aria-label="Selected audio">
        {selectedId && inspector
          ? inspector
          : <p className="fracture-inspector-hint">Pick anything on the map to hear it.</p>}
      </section>
    </section>
  );
}
