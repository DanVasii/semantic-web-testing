import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-brand-600 bg-brand-600 text-white hover:border-brand-700 hover:bg-brand-700",
  secondary:
    "border-app-border bg-app-surface text-app-ink hover:border-brand-500 hover:bg-brand-50",
  danger:
    "border-red-600 bg-red-600 text-white hover:border-red-700 hover:bg-red-700",
};

export const Button = ({
  className = "",
  type = "button",
  variant = "primary",
  ...buttonProps
}: ButtonProps) => (
  <button
    type={type}
    className={`inline-flex min-h-10 items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${className}`.trim()}
    {...buttonProps}
  />
);
