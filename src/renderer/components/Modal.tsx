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
      className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-slate-950/45 p-4 sm:p-6"
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
        className={`flex max-h-[calc(100vh-2rem)] min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-2xl sm:max-h-[calc(100vh-3rem)] ${
          size === "wide" ? "max-w-6xl" : "max-w-2xl"
        }`}
      >
        <header className="flex min-w-0 shrink-0 items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
          <h2
            id={titleId}
            className="min-w-0 break-words text-xl font-semibold text-app-ink"
          >
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
        <div className="mt-4 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 pb-5 text-sm leading-6 text-app-muted sm:px-6 sm:pb-6">
          {children}
        </div>
      </section>
    </div>
  );
};
