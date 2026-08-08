"use client";

import { useMemo, useState } from "react";
import { MergeFieldPicker, renderMergePills, type MergeField } from "./MergeFieldPicker";

export interface TemplateCanvasProps {
  body: string;
  onChange: (body: string) => void;
  mergeFields?: MergeField[];
  orientation?: "portrait" | "landscape";
}

export function TemplateCanvas({
  body,
  onChange,
  mergeFields,
  orientation = "portrait",
}: TemplateCanvasProps) {
  const [zoom, setZoom] = useState(100);

  const preview = useMemo(() => renderMergePills(body), [body]);

  const insertAtCursor = (token: string) => {
    onChange(body + token);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <MergeFieldPicker fields={mergeFields} onInsert={insertAtCursor} />
        <label style={{ fontSize: 12, color: "var(--mut)", display: "flex", alignItems: "center", gap: 6 }}>
          Zoom
          <input
            type="range"
            min={50}
            max={150}
            step={10}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
          />
          {zoom}%
        </label>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        <textarea
          aria-label="Certificate template body"
          value={body}
          onChange={(e) => onChange(e.target.value)}
          rows={14}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: 13,
            padding: 12,
            borderRadius: "var(--r-sm)",
            border: "1px solid var(--line)",
            background: "var(--panel)",
            resize: "vertical",
          }}
        />
        <div
          aria-label="Certificate preview"
          style={{
            transform: `scale(${zoom / 100})`,
            transformOrigin: "top left",
            width: orientation === "portrait" ? 210 : 297,
            minHeight: orientation === "portrait" ? 297 : 210,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-sm)",
            boxShadow: "var(--shadow-sm)",
            padding: 16,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8, marginBottom: 12, fontSize: 11, color: "var(--mut)" }}>
            Letterhead · tenant logo
          </div>
          <div style={{ flex: 1, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5 }}>
            {preview || "Start typing your certificate text…"}
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontSize: 11, color: "var(--mut)" }}>
            <span>Signatory</span>
            <span>QR verify</span>
          </div>
        </div>
      </div>
    </div>
  );
}
