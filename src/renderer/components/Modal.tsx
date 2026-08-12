import { useEffect, useId, type ReactNode } from "react";

import { Button } from "./Button.js";

export interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  size?: "default" | "wide";
}

export const Modal = ({
  children,
  onClose,
  open,
  size = "default",
  title,
}: ModalProps) => {
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-2xl border border-app-border bg-app-surface p-5 shadow-2xl sm:max-h-[calc(100vh-3rem)] sm:p-6 ${
          size === "wide" ? "max-w-6xl" : "max-w-2xl"
        }`}
      >
        <header className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-xl font-semibold text-app-ink">
            {title}
          </h2>
          <Button
            variant="secondary"
            className="min-h-8 px-2 py-1"
            aria-label="Închide dialogul"
            onClick={onClose}
          >
            ×
          </Button>
        </header>
        <div className="mt-4 text-sm leading-6 text-app-muted">{children}</div>
      </section>
    </div>
  );
};
