"use client";

export type LocaleKey = "en" | "hi";

export interface LocaleTabsProps {
  active: LocaleKey;
  onChange: (locale: LocaleKey) => void;
  completeness?: { en: boolean; hi: boolean };
}

export function LocaleTabs({ active, onChange, completeness }: LocaleTabsProps) {
  const tabs: { key: LocaleKey; label: string }[] = [
    { key: "en", label: "English" },
    { key: "hi", label: "हिंदी" },
  ];
  return (
    <div role="tablist" aria-label="Locale" style={{ display: "flex", gap: 4, marginBottom: 8 }}>
      {tabs.map((tab) => {
        const selected = active === tab.key;
        const complete = completeness?.[tab.key];
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            className={selected ? "btn primary" : "btn ghost"}
            onClick={() => onChange(tab.key)}
            style={{ padding: "4px 10px", fontSize: 12 }}
          >
            {tab.label}
            {complete === false ? " ○" : complete === true ? " ●" : ""}
          </button>
        );
      })}
    </div>
  );
}
