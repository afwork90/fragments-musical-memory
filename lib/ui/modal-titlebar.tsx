"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ModalTitlebarProps = {
  eyebrow: string;
  title: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
};

export function ModalTitlebar({
  eyebrow,
  title,
  onClose,
  closeLabel,
  className,
}: ModalTitlebarProps) {
  const titleNode =
    typeof title === "string" || typeof title === "number" ? (
      <h1 className="modal-titlebar-title">{title}</h1>
    ) : (
      title
    );

  return (
    <div className={cn("modal-titlebar", className)}>
      <div className="modal-titlebar-copy">
        <span className="eyebrow">{eyebrow}</span>
        <div className="modal-titlebar-heading">{titleNode}</div>
      </div>
      {onClose && (
        <button
          type="button"
          className="panel-close"
          onClick={onClose}
          aria-label={closeLabel ?? `Close ${eyebrow}`}
        >
          ×
        </button>
      )}
    </div>
  );
}
