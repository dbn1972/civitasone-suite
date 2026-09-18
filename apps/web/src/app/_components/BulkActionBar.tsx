"use client";

import { Button } from "./ds";

interface BulkAction {
  label: string;
  icon?: string;
  onClick: () => void;
  variant?: "primary" | "danger" | "default";
}

interface BulkActionBarProps {
  selectedCount: number;
  actions: BulkAction[];
}

export function BulkActionBar({ selectedCount, actions }: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 900,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "12px 24px",
        background: "#1e293b",
        borderTop: "1px solid #334155",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          maxWidth: 900,
          width: "100%",
        }}
      >
        <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600, whiteSpace: "nowrap" }}>
          {selectedCount} selected
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {actions.map((action, i) => (
            <Button
              key={i}
              onClick={action.onClick}
              type="button"
              size="sm"
              variant={
                action.variant === "primary" ? "primary" : action.variant === "danger" ? "danger" : "ghost"
              }
            >
              {action.icon && <span>{action.icon}</span>}
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
