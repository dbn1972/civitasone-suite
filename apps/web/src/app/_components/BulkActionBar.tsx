"use client";

import React from "react";

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

  const getButtonStyle = (variant?: string): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "6px 14px",
      border: "none",
      borderRadius: 6,
      fontSize: 13,
      fontWeight: 500,
      cursor: "pointer",
      transition: "background 0.15s",
    };
    switch (variant) {
      case "primary":
        return { ...base, background: "#4f46e5", color: "#fff" };
      case "danger":
        return { ...base, background: "#ef4444", color: "#fff" };
      default:
        return { ...base, background: "#fff", color: "#374151", border: "1px solid #d1d5db" };
    }
  };

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
            <button
              key={i}
              onClick={action.onClick}
              type="button"
              style={getButtonStyle(action.variant)}
            >
              {action.icon && <span>{action.icon}</span>}
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
