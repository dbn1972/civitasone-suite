"use client";

import { useRef, type KeyboardEvent } from "react";

interface TabsProps {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  // Roving tabindex: only the selected tab sits in the page Tab order: the
  // WAI-ARIA tabs pattern moves focus *within* the tablist with the arrow
  // keys instead. Refs let us move DOM focus to the newly-active tab after
  // an arrow key, since changing which tab is selected doesn't move focus
  // by itself.
  const tabRefs = useRef<Array<HTMLSpanElement | null>>([]);

  function onTabKeyDown(e: KeyboardEvent<HTMLSpanElement>, index: number) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onChange(tabs[index]);
      return;
    }

    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = tabs.length - 1;

    if (nextIndex === null) return;
    e.preventDefault();
    // Automatic activation, matching this component's existing
    // click/Enter/Space behavior of activating immediately on interaction
    // (rather than requiring a separate confirm keypress after moving focus).
    onChange(tabs[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab, index) => {
        const selected = tab === active;
        return (
          <span
            key={tab}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            className={selected ? "on" : undefined}
            onClick={() => onChange(tab)}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => onTabKeyDown(e, index)}
          >
            {tab}
          </span>
        );
      })}
    </div>
  );
}
