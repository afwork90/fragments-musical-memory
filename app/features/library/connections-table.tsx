"use client";

import { SignalCell } from "@/lib/audio/signal-cell";
import { Button } from "@/lib/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/lib/ui/table";
import { cn } from "@/lib/utils";
import { Fragment, Relationship, SourceFile } from "../../prototype-data";
import { CONNECTIONS_COLUMNS } from "./connections-columns";

export type ScoredConnection = Relationship & { score: number; otherId: string };

type ConnectionsTableProps = {
  connections: ScoredConnection[];
  selectedFragmentId: string;
  previewingId: string | null;
  fragmentFor: (id: string) => Fragment;
  sourceNameFor: (fragment: Fragment) => string;
  sourceForId: (sourceId: string) => SourceFile | undefined;
  onPreview: (fragment: Fragment, relationship: ScoredConnection) => void;
  onCombine: (relationship: ScoredConnection) => void;
  onEditSource: (fragmentId: string) => void;
};

export function ConnectionsTable({
  connections,
  selectedFragmentId,
  previewingId,
  fragmentFor,
  sourceNameFor,
  sourceForId,
  onPreview,
  onCombine,
  onEditSource,
}: ConnectionsTableProps) {
  return (
    <div className="library-table connections-table-scroll mt-2 flex-1 overflow-auto rounded-md border border-border bg-card/40">
      <Table className="min-w-[900px]" aria-label="Fragment matches">
        <TableHeader>
          <TableRow className="border-border/80 hover:bg-transparent">
            {CONNECTIONS_COLUMNS.map((column) => (
              <TableHead
                key={column.id}
                className="h-8 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {connections.map((relationship, index) => {
            const target = fragmentFor(relationship.otherId);
            const sourceName = sourceNameFor(target);
            const source = sourceForId(target.sourceId);
            const slice = source
              ? { start: target.start, end: target.end, duration: source.duration }
              : undefined;
            const isFeatured = index === 0;

            return (
              <TableRow
                key={relationship.id}
                className={cn(
                  "border-border/60 text-[11px] text-muted-foreground transition-colors",
                  "hover:bg-white/[0.04] hover:text-foreground/85",
                  isFeatured && "library-row-selected border-l-2 border-l-[var(--violet)] text-foreground",
                )}
              >
                <TableCell className="px-2 py-2 font-[family-name:var(--font-geist-mono)] text-[var(--lime)]">
                  <span className="text-sm font-semibold">{relationship.score}</span>
                  <span className="text-[9px]">%</span>
                </TableCell>
                <TableCell className="max-w-[160px] px-2 py-2 font-medium text-foreground">
                  {target.id === "f02" && selectedFragmentId === "f01" && (
                    <i className="mb-0.5 block text-[9px] not-italic text-[var(--violet)]">Rediscovered · 2018</i>
                  )}
                  <span className="block truncate" title={target.name}>
                    {target.name}
                  </span>
                  <small className="block truncate text-[9px] font-normal text-muted-foreground" title={relationship.reason}>
                    {relationship.reason}
                  </small>
                </TableCell>
                <TableCell className="max-w-[120px] truncate px-2 py-2" title={sourceName}>
                  {sourceName}
                </TableCell>
                <TableCell className="px-2 py-1.5">
                  <SignalCell
                    values={target.waveform}
                    sourceId={target.sourceId}
                    cacheSourceAudio
                    slice={slice}
                    isPreviewing={previewingId === target.id}
                    onPreview={() => onPreview(target, relationship)}
                    ariaLabel={`${previewingId === target.id ? "Stop" : "Play"} ${target.name}`}
                    waveClassName="source-signal-wave h-11 min-w-[120px] flex-1"
                  />
                </TableCell>
                <TableCell className="px-2 py-2">{target.dateLabel}</TableCell>
                <TableCell
                  className="max-w-[100px] truncate px-2 py-2"
                  title={target.alternateKeys.length ? `Also: ${target.alternateKeys.join(", ")}` : target.key}
                >
                  {target.key}
                  {target.alternateKeys.length > 0 && (
                    <span className="ml-1 text-muted-foreground/70">+{target.alternateKeys.length}</span>
                  )}
                </TableCell>
                <TableCell className="px-2 py-2">{target.bpm > 0 ? target.bpm : "—"}</TableCell>
                <TableCell className="px-2 py-2">{target.role}</TableCell>
                <TableCell className="px-2 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="h-6 border-border/80 px-2 text-[10px]"
                      onClick={() => onEditSource(target.id)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="h-6 border-[#a99cff35] bg-[#a99cff12] px-2 text-[10px] text-[var(--violet)] hover:bg-[#a99cff22] hover:text-[var(--violet)]"
                      onClick={() => onCombine(relationship)}
                    >
                      Affinities
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {connections.length === 0 && (
        <div className="empty-inline border-t border-border/60">No authored matches for this fragment.</div>
      )}
    </div>
  );
}
