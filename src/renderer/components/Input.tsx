import { useId, type InputHTMLAttributes } from "react";

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id"
> {
  id?: string;
  label: string;
  error?: string;
  hint?: string;
}

export const Input = ({
  "aria-describedby": ariaDescribedBy,
  className = "",
  error,
  hint,
  id,
  label,
  ...inputProps
}: InputProps) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = error
    ? `${inputId}-error`
    : hint
      ? `${inputId}-hint`
      : ariaDescribedBy;

  return (
    <div className="grid gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-app-ink">
        {label}
      </label>
      <input
        id={inputId}
        aria-describedby={descriptionId}
        aria-invalid={error ? true : undefined}
        className={`min-h-10 rounded-lg border bg-app-surface px-3 py-2 text-sm text-app-ink shadow-sm outline-none transition-colors placeholder:text-app-muted focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-app-muted ${
          error ? "border-red-500" : "border-app-border"
        } ${className}`.trim()}
        {...inputProps}
      />
      {error ? (
        <p id={descriptionId} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p id={descriptionId} className="text-sm text-app-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
};
