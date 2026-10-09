import { useId, useState } from "react";

import { Button } from "./Button.js";

export interface DropdownItem {
  id: string;
  label: string;
  disabled?: boolean;
  tone?: "default" | "danger";
  onSelect?: () => void;
}

export interface DropdownProps {
  align?: "left" | "right";
  compact?: boolean;
  label: string;
  items: DropdownItem[];
}

export const Dropdown = ({
  align = "left",
  compact = false,
  items,
  label,
}: DropdownProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const menuId = useId();

  return (
    <div className="relative inline-flex">
      <Button
        variant="secondary"
        size={compact ? "compact" : "default"}
        aria-controls={menuId}
        aria-expanded={isExpanded}
        aria-haspopup="menu"
        onClick={() => {
          setIsExpanded((currentValue) => !currentValue);
        }}
      >
        {label}
        <span aria-hidden="true" className="ml-2 text-app-muted">
          ▾
        </span>
      </Button>

      {isExpanded ? (
        <div
          id={menuId}
          role="menu"
          className={`absolute top-full z-20 mt-2 min-w-48 rounded-xl border border-app-border bg-app-surface p-1.5 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`flex w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-50 focus:bg-brand-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                item.tone === "danger" ? "text-red-700" : "text-app-ink"
              }`}
              onClick={() => {
                item.onSelect?.();
                setIsExpanded(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
