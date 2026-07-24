import { useId, useState, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  label: string;
  tabs: TabItem[];
  initialTabId?: string;
  onChange?: (tabId: string) => void;
}

export const Tabs = ({ initialTabId, label, onChange, tabs }: TabsProps) => {
  const componentId = useId();
  const firstTabId = tabs[0]?.id ?? "";
  const [activeTabId, setActiveTabId] = useState(initialTabId ?? firstTabId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 rounded-xl bg-stone-100 p-1"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const tabElementId = `${componentId}-${tab.id}-tab`;
          const panelElementId = `${componentId}-${tab.id}-panel`;

          return (
            <button
              key={tab.id}
              id={tabElementId}
              type="button"
              role="tab"
              aria-controls={panelElementId}
              aria-selected={isActive}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
                isActive
                  ? "bg-app-surface text-app-ink shadow-sm"
                  : "text-app-muted hover:text-app-ink"
              }`}
              onClick={() => {
                setActiveTabId(tab.id);
                onChange?.(tab.id);
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab ? (
        <div
          id={`${componentId}-${activeTab.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${componentId}-${activeTab.id}-tab`}
          className="mt-3 rounded-xl border border-app-border bg-app-surface p-4 text-sm text-app-muted"
        >
          {activeTab.content}
        </div>
      ) : null}
    </div>
  );
};
