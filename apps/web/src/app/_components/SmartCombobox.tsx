"use client";

/**
 * SmartCombobox — a combobox input that combines typed text with recent suggestions.
 * Shows "Recently used" section and optional "All results" section.
 * Keyboard navigable: Arrow keys + Enter to select.
 * Accessible: combobox role, aria-expanded, aria-activedescendant.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRecentValues } from "@/lib/smartDefaults";

interface SmartComboboxProps {
  /** Storage key for recent values */
  recentKey: string;
  /** Full list of all available options */
  allOptions?: string[];
  /** Current value */
  value: string;
  /** Change handler */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Label for the field */
  label?: string;
  /** Max recent items to show */
  maxRecent?: number;
  /** Additional class name */
  className?: string;
}

export function SmartCombobox({
  recentKey,
  allOptions = [],
  value,
  onChange,
  placeholder = "Type to search…",
  label,
  maxRecent = 5,
  className,
}: SmartComboboxProps) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const { values: recentValues, save } = useRecentValues(recentKey, maxRecent);

  // Filter suggestions based on current input
  const query = value.toLowerCase();
  const recentFiltered = recentValues.filter(
    (v: string) => !query || v.toLowerCase().includes(query),
  );
  const allFiltered = allOptions.filter(
    (v: string) =>
      (!query || v.toLowerCase().includes(query)) &&
      !recentFiltered.includes(v),
  );

  const allItems = [
    ...recentFiltered.map((v) => ({ value: v, section: "recent" as const })),
    ...allFiltered.map((v) => ({ value: v, section: "all" as const })),
  ];

  const selectItem = useCallback(
    (itemValue: string) => {
      onChange(itemValue);
      save(itemValue);
      setOpen(false);
      setActiveIndex(-1);
    },
    [onChange, save],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      setActiveIndex(0);
      e.preventDefault();
      return;
    }

    if (!open) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, allItems.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && allItems[activeIndex]) {
          selectItem(allItems[activeIndex].value);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.parentElement?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const activeId = activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;

  return (
    <div className={className} style={{ position: "relative" }}>
      {label && (
        <label htmlFor={`${id}-input`} style={{ display: "block", marginBottom: 4, fontSize: 13, fontWeight: 500 }}>
          {label}
        </label>
      )}
      <input
        ref={inputRef}
        id={`${id}-input`}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        style={{
          width: "100%",
          border: "1px solid #d1d5db",
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 14,
          outline: "none",
        }}
      />
      {open && allItems.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={label || "Suggestions"}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: "var(--surface, #fff)",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            maxHeight: 240,
            overflow: "auto",
            zIndex: 100,
            listStyle: "none",
            padding: 0,
            margin: 0,
          }}
        >
          {recentFiltered.length > 0 && (
            <li
              aria-hidden
              style={{ padding: "6px 12px", fontSize: 11, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase" }}
            >
              Recently used
            </li>
          )}
          {allItems.map((item, idx) => (
            <li
              key={`${item.section}-${item.value}`}
              id={`${id}-option-${idx}`}
              role="option"
              aria-selected={idx === activeIndex}
              onClick={() => selectItem(item.value)}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                fontSize: 14,
                background: idx === activeIndex ? "#eff6ff" : "transparent",
                ...(item.section === "all" && idx === recentFiltered.length
                  ? { borderTop: "1px solid #f3f4f6" }
                  : {}),
              }}
            >
              {item.section === "all" && idx === recentFiltered.length && (
                <span
                  aria-hidden
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#9ca3af",
                    textTransform: "uppercase",
                    marginBottom: 4,
                    marginTop: -4,
                  }}
                >
                  All results
                </span>
              )}
              {item.value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
