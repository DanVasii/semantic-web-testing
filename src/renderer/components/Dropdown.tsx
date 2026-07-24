import { useId, useState } from "react";

import { Button } from "./Button.js";

export interface DropdownItem {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect?: () => void;
}

export interface DropdownProps {
  label: string;
  items: DropdownItem[];
}

export const Dropdown = ({ items, label }: DropdownProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const menuId = useId();

  return (
    <div className="relative inline-flex">
      <Button
        variant="secondary"
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
          className="absolute top-full left-0 z-20 mt-2 min-w-48 rounded-xl border border-app-border bg-app-surface p-1.5 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className="flex w-full rounded-lg px-3 py-2 text-left text-sm text-app-ink hover:bg-brand-50 focus:bg-brand-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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
