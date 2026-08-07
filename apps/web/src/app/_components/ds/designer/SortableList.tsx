"use client";

import type { ReactNode } from "react";

export interface SortableListItem {
  id: string;
}

export interface SortableListProps<T extends SortableListItem> {
  items: T[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  renderItem: (item: T, index: number) => ReactNode;
  ariaLabel?: string;
}

export function SortableList<T extends SortableListItem>({
  items,
  selectedId,
  onSelect,
  onMoveUp,
  onMoveDown,
  renderItem,
  ariaLabel = "Sortable list",
}: SortableListProps<T>) {
  return (
    <ul role="list" aria-label={ariaLabel} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
      {items.map((item, index) => {
        const selected = item.id === selectedId;
        return (
          <li
            key={item.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 8,
              alignItems: "center",
              padding: "8px 10px",
              borderRadius: "var(--r-sm)",
              border: selected ? "1px solid var(--primary)" : "1px solid var(--line)",
              background: selected ? "var(--primary-soft)" : "var(--panel)",
            }}
          >
            <button
              type="button"
              onClick={() => onSelect?.(item.id)}
              style={{
                textAlign: "left",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "inherit",
                font: "inherit",
              }}
            >
              {renderItem(item, index)}
            </button>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button
                type="button"
                className="btn ghost"
                aria-label="Move up"
                disabled={index === 0}
                onClick={() => onMoveUp(item.id)}
                style={{ padding: "2px 8px", minWidth: 32 }}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn ghost"
                aria-label="Move down"
                disabled={index === items.length - 1}
                onClick={() => onMoveDown(item.id)}
                style={{ padding: "2px 8px", minWidth: 32 }}
              >
                ↓
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
