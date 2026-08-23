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
import { SourceFile } from "../../prototype-data";

type SourceRowActionsProps = {
  source: SourceFile;
  onRemove: (sourceId: string) => void;
};

export function SourceRowActions({ source, onRemove }: SourceRowActionsProps) {
  const [removeOpen, setRemoveOpen] = useState(false);

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
        <DropdownMenuContent align="end" className="min-w-[8.5rem]">
          <DropdownMenuItem
            variant="destructive"
            className="text-[11px]"
            onSelect={() => setRemoveOpen(true)}
          >
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <ModalTitlebar
              className="mb-0"
              eyebrow="Remove"
              title={<DialogTitle className="modal-titlebar-title">{source.name}</DialogTitle>}
            />
            <DialogDescription className="mt-2">
              This removes <strong className="font-medium text-foreground">{source.name}</strong> and all
              of its fragments from Fragments. Your original file is not deleted — only the copy made on
              import is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRemoveOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                onRemove(source.id);
                setRemoveOpen(false);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
