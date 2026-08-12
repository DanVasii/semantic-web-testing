import { useId, type SelectHTMLAttributes } from "react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "id"
> {
  id?: string;
  label: string;
  options: SelectOption[];
  error?: string;
}

export const Select = ({
  "aria-describedby": ariaDescribedBy,
  className = "",
  error,
  id,
  label,
  options,
  ...selectProps
}: SelectProps) => {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const errorId = error ? `${selectId}-error` : undefined;

  return (
    <div className="grid gap-1.5">
      <label htmlFor={selectId} className="text-sm font-medium text-app-ink">
        {label}
      </label>
      <select
        id={selectId}
        aria-describedby={errorId ?? ariaDescribedBy}
        aria-invalid={error ? true : undefined}
        className={`min-h-10 rounded-lg border bg-app-surface px-3 py-2 text-sm text-app-ink shadow-sm outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-app-muted ${
          error ? "border-red-500" : "border-app-border"
        } ${className}`.trim()}
        {...selectProps}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
};
