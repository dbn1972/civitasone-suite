"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Segmented } from "../Segmented";

export interface SplitPreviewProps {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  debounceMs?: number;
  revision?: number;
}

export function SplitPreview({
  open,
  onToggle,
  children,
  debounceMs = 300,
  revision = 0,
}: SplitPreviewProps) {
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), debounceMs);
    return () => clearTimeout(t);
  }, [open, revision, debounceMs]);

  if (!open) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button type="button" className="btn ghost" onClick={onToggle}>Preview</button>
      </div>
    );
  }

  return (
    <div
      aria-label="Form preview"
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--r-sm)",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
        minHeight: 320,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>Preview</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Segmented
            options={["360px", "Desktop"]}
            value={device === "mobile" ? "360px" : "Desktop"}
            onChange={(v) => setDevice(v === "360px" ? "mobile" : "desktop")}
          />
          <button type="button" className="btn ghost" onClick={onToggle}>Close</button>
        </div>
      </div>
      <div
        style={{
          flex: 1,
          padding: 16,
          display: "flex",
          justifyContent: "center",
          background: "var(--bg)",
          overflow: "auto",
        }}
      >
        <div
          style={{
            width: device === "mobile" ? 360 : "100%",
            maxWidth: device === "desktop" ? 720 : 360,
            transition: "width 150ms ease-out",
            opacity: visible ? 1 : 0.6,
          }}
        >
          {visible ? children : <p style={{ color: "var(--mut)", fontSize: 13 }}>Updating preview…</p>}
        </div>
      </div>
    </div>
  );
}
