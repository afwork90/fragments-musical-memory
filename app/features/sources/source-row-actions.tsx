"use client";

import { useState } from "react";
import { MoreVertical } from "lucide-react";
import { Button } from "@/lib/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/lib/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/lib/ui/dropdown-menu";
import { ModalTitlebar } from "@/lib/ui/modal-titlebar";
import type { SourceFile } from "@/lib/view/source-file";

type SourceRowActionsProps = {
  source: SourceFile;
  onRemove: (sourceId: string) => void;
  onDelete: (sourceId: string) => void;
  /** False in the web preview, which can read the library but not change it. */
  canDeleteFiles: boolean;
};

/**
 * The two removals are deliberately separate, and both confirm.
 *
 * "Remove from library" is reversible — the folder stays on disk and re-importing
 * the same filename brings the source back with its slices, which is what makes it
 * safe to use during a demo. "Delete from disk" is not reversible, so it says so in
 * those words and names what goes: the audio copy, the slices, and the analysis.
 */
type PendingAction = "remove" | "delete";

const COPY: Record<PendingAction, { eyebrow: string; confirm: string }> = {
  remove: { eyebrow: "Remove", confirm: "Remove from library" },
  delete: { eyebrow: "Delete", confirm: "Delete from disk" },
};

function unavailableReason(imported: boolean | undefined) {
  return imported
    ? "Deleting files needs the desktop app. The web preview can only read your library."
    : "This source is part of the demo dataset, so there is no folder on disk.";
}

export function SourceRowActions({
  source,
  onRemove,
  onDelete,
  canDeleteFiles,
}: SourceRowActionsProps) {
  const [pending, setPending] = useState<PendingAction | null>(null);
  // Only imported sources have a folder, and only a host that can write to disk can
  // remove one. The prototype rows in the demo dataset have nothing on disk.
  const deletable = source.imported && canDeleteFiles;

  const confirmAction = () => {
    if (pending === "remove") onRemove(source.id);
    if (pending === "delete") onDelete(source.id);
    setPending(null);
  };

  return (
    <div className="source-row-actions flex justify-end" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Actions for ${source.name}`}
          >
            <MoreVertical className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[9.5rem]">
          <DropdownMenuItem className="text-[11px]" onSelect={() => setPending("remove")}>
            Remove from library
          </DropdownMenuItem>
          {/* Shown but disabled where it cannot work, rather than hidden: a missing
              item reads as a missing feature, and confirming a deletion that is then
              refused is worse than both.

              The title sits on a wrapper because a disabled item has
              `pointer-events: none`, so a tooltip on the item itself never appears. */}
          <span title={deletable ? undefined : unavailableReason(source.imported)}>
            <DropdownMenuItem
              variant="destructive"
              className="text-[11px]"
              disabled={!deletable}
              onSelect={() => setPending("delete")}
            >
              Delete from disk
            </DropdownMenuItem>
          </span>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <ModalTitlebar
              className="mb-0"
              eyebrow={pending ? COPY[pending].eyebrow : ""}
              title={<DialogTitle className="modal-titlebar-title">{source.name}</DialogTitle>}
            />
            <DialogDescription className="mt-2">
              {pending === "delete" ? (
                <>
                  This permanently deletes the folder for{" "}
                  <strong className="font-medium text-foreground">{source.name}</strong> — the audio
                  copy, its slices, and everything measured about it. It cannot be undone, and your
                  original file elsewhere on disk is untouched.
                </>
              ) : (
                <>
                  This removes <strong className="font-medium text-foreground">{source.name}</strong>{" "}
                  and its fragments from Fragments. Your source folder and slices are kept on disk —
                  import a file with the same name again to restore them.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={confirmAction}>
              {pending ? COPY[pending].confirm : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
