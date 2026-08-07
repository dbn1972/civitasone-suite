"use client";

import type { ReactNode } from "react";

export interface PropertyPanelProps {
  title?: string;
  emptyMessage?: string;
  selected: boolean;
  children?: ReactNode;
}

export function PropertyPanel({
  title = "Field properties",
  emptyMessage = "Select a field on the canvas to edit its properties.",
  selected,
  children,
}: PropertyPanelProps) {
  return (
    <aside
      aria-label="Property panel"
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--r-sm)",
        background: "var(--panel)",
        padding: 16,
        minHeight: 200,
        overflowY: "auto",
      }}
    >
      <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600, color: "var(--ink2)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {title}
      </h3>
      {!selected ? (
        <p style={{ margin: 0, fontSize: 14, color: "var(--mut)" }}>{emptyMessage}</p>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>{children}</div>
      )}
    </aside>
  );
}
