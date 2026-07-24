export type ToastVariant = "success" | "warning" | "error";

export interface ToastProps {
  variant: ToastVariant;
  title: string;
  message: string;
  onDismiss?: () => void;
}

const toastStyles: Record<ToastVariant, { container: string; marker: string }> =
  {
    success: {
      container: "border-emerald-200 bg-emerald-50",
      marker: "bg-emerald-600",
    },
    warning: {
      container: "border-amber-200 bg-amber-50",
      marker: "bg-amber-500",
    },
    error: {
      container: "border-red-200 bg-red-50",
      marker: "bg-red-600",
    },
  };

export const Toast = ({ message, onDismiss, title, variant }: ToastProps) => (
  <section
    role={variant === "success" ? "status" : "alert"}
    className={`flex items-start gap-3 rounded-xl border p-4 shadow-sm ${toastStyles[variant].container}`}
  >
    <span
      aria-hidden="true"
      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${toastStyles[variant].marker}`}
    />
    <div className="min-w-0 flex-1">
      <h3 className="text-sm font-semibold text-app-ink">{title}</h3>
      <p className="mt-1 text-sm text-app-muted">{message}</p>
    </div>
    {onDismiss ? (
      <button
        type="button"
        aria-label="Închide notificarea"
        className="rounded-md px-1 text-app-muted hover:text-app-ink focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
        onClick={onDismiss}
      >
        ×
      </button>
    ) : null}
  </section>
);
