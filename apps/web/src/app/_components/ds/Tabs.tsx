"use client";

interface TabsProps {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <span
          key={tab}
          className={tab === active ? "on" : undefined}
          onClick={() => onChange(tab)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onChange(tab)}
        >
          {tab}
        </span>
      ))}
    </div>
  );
}
