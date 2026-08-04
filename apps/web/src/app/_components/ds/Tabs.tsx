"use client";

interface TabsProps {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => {
        const selected = tab === active;
        return (
          <span
            key={tab}
            className={selected ? "on" : undefined}
            onClick={() => onChange(tab)}
            role="tab"
            aria-selected={selected}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onChange(tab);
              }
            }}
          >
            {tab}
          </span>
        );
      })}
    </div>
  );
}
