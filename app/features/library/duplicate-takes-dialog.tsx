"use client";

import { Waveform } from "@/components/audio/waveform";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Fragment } from "@/app/prototype-data";

type DuplicateTakesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fragments: Fragment[];
  selectedId: string;
  previewingId: string | null;
  onPreview: (fragment: Fragment) => void;
  onMarkSeparate: (fragmentId: string) => void;
  onArchive: (fragmentId: string) => void;
  onKeepTake: (fragmentId: string) => void;
};

export function DuplicateTakesDialog({
  open,
  onOpenChange,
  fragments,
  selectedId,
  previewingId,
  onPreview,
  onMarkSeparate,
  onArchive,
  onKeepTake,
}: DuplicateTakesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto border-border bg-card sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Takes</DialogTitle>
          <DialogDescription>
            Compare related recordings and choose which take to keep for matching.
          </DialogDescription>
        </DialogHeader>

        <div className="duplicate-list space-y-2">
          {fragments.map((fragment, index) => (
            <div
              key={fragment.id}
              className={`duplicate-row grid items-center gap-3 rounded-md border border-border/70 p-3 ${fragment.id === selectedId ? "current border-primary/40 bg-primary/5" : ""}`}
            >
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="round-play"
                onClick={() => onPreview(fragment)}
              >
                {previewingId === fragment.id ? "Ⅱ" : "▶"}
              </Button>
              <Waveform values={fragment.waveform} active={previewingId === fragment.id} />
              <span className="min-w-0">
                <b className="block truncate text-sm">{fragment.name}</b>
                <small className="text-xs text-muted-foreground">
                  {fragment.dateLabel} · {fragment.duration}
                  {index === 0 && " · strongest recording"}
                </small>
              </span>
              <div className="duplicate-actions flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onMarkSeparate(fragment.id)}>
                  Not a duplicate
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => onArchive(fragment.id)}>
                  Archive
                </Button>
              </div>
              <Button
                type="button"
                size="sm"
                variant="lime"
                onClick={() => onKeepTake(fragment.id)}
              >
                Keep this for matching
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter className="sm:justify-between">
          <span className="text-xs text-muted-foreground">
            No cleanup is required. Fragments will keep working either way.
          </span>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
