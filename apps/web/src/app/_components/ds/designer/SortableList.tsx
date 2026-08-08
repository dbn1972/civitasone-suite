"use client";

import { useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";

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
  /** When item count ≥ this, window the list (UX: beyond 50 fields). Default 50; set 0 to disable. */
  virtualizeThreshold?: number;
  rowHeightPx?: number;
  maxViewportPx?: number;
}

function visibleWindow(
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 6,
): { start: number; end: number; paddingTop: number; paddingBottom: number } {
  if (itemCount <= 0) {
    return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };
  }
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(itemCount, start + visible);
  return {
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, (itemCount - end) * rowHeight),
  };
}

export function SortableList<T extends SortableListItem>({
  items,
  selectedId,
  onSelect,
  onMoveUp,
  onMoveDown,
  renderItem,
  ariaLabel = "Sortable list",
  virtualizeThreshold = 50,
  rowHeightPx = 56,
  maxViewportPx = 420,
}: SortableListProps<T>) {
  const scrollRef = useRef<HTMLUListElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const virtualize =
    virtualizeThreshold > 0 && items.length >= virtualizeThreshold;

  const windowed = useMemo(() => {
    if (!virtualize) {
      return { start: 0, end: items.length, paddingTop: 0, paddingBottom: 0 };
    }
    return visibleWindow(items.length, scrollTop, maxViewportPx, rowHeightPx);
  }, [virtualize, items.length, scrollTop, maxViewportPx, rowHeightPx]);

  const onScroll = (e: UIEvent<HTMLUListElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const slice = items.slice(windowed.start, windowed.end);

  return (
    <ul
      ref={scrollRef}
      role="list"
      aria-label={ariaLabel}
      onScroll={virtualize ? onScroll : undefined}
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "grid",
        gap: virtualize ? 0 : 6,
        ...(virtualize
          ? {
              maxHeight: maxViewportPx,
              overflowY: "auto",
              position: "relative" as const,
            }
          : {}),
      }}
    >
      {virtualize ? (
        <li aria-hidden style={{ height: windowed.paddingTop, padding: 0, border: "none" }} />
      ) : null}
      {slice.map((item, localIdx) => {
        const index = windowed.start + localIdx;
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
              marginBottom: virtualize ? 6 : 0,
              minHeight: virtualize ? rowHeightPx - 6 : undefined,
              boxSizing: "border-box",
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
      {virtualize ? (
        <li aria-hidden style={{ height: windowed.paddingBottom, padding: 0, border: "none" }} />
      ) : null}
    </ul>
  );
}
