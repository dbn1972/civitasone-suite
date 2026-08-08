"use client";

import { useMemo, useRef, useState } from "react";
import { MergeFieldPicker, renderMergePills, type MergeField } from "./MergeFieldPicker";
import type { OutputType, TemplateOrientation } from "./issuanceTypes";

export interface TemplateCanvasProps {
  body: string;
  onChange: (body: string) => void;
  mergeFields?: MergeField[];
  orientation?: TemplateOrientation;
  onOrientationChange?: (orientation: TemplateOrientation) => void;
  outputType?: OutputType;
  signatoryLabel?: string;
  qrVerifyEnabled?: boolean;
  onQrVerifyChange?: (enabled: boolean) => void;
  /** Optional pre-rendered sample merge for the right pane (sandbox). */
  samplePreviewText?: string | null;
  samplePreviewBanner?: string | null;
}

function canvasTitle(outputType: OutputType | undefined): string {
  switch (outputType) {
    case "closure_note":
      return "Closure note";
    case "licence":
      return "Licence";
    case "receipt":
      return "Receipt";
    default:
      return "Certificate";
  }
}

export function TemplateCanvas({
  body,
  onChange,
  mergeFields,
  orientation = "portrait",
  onOrientationChange,
  outputType = "certificate",
  signatoryLabel,
  qrVerifyEnabled = true,
  onQrVerifyChange,
  samplePreviewText,
  samplePreviewBanner,
}: TemplateCanvasProps) {
  const [zoom, setZoom] = useState(100);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const pillPreview = useMemo(() => renderMergePills(body), [body]);
  const preview = samplePreviewText?.trim() ? samplePreviewText : pillPreview;

  const insertAtCursor = (token: string) => {
    const el = textareaRef.current;
    if (!el) {
      onChange(body + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? start;
    const next = body.slice(0, start) + token + body.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      const pos = start + token.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const mmWidth = orientation === "portrait" ? 210 : 297;
  const mmHeight = orientation === "portrait" ? 297 : 210;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <MergeFieldPicker fields={mergeFields} onInsert={insertAtCursor} />
        {onOrientationChange ? (
          <div role="group" aria-label="Page orientation" style={{ display: "flex", gap: 4 }}>
            {(["portrait", "landscape"] as const).map((o) => (
              <button
                key={o}
                type="button"
                className={orientation === o ? "btn primary" : "btn ghost"}
                onClick={() => onOrientationChange(o)}
                style={{ fontSize: 12, padding: "2px 8px", textTransform: "capitalize" }}
              >
                {o}
              </button>
            ))}
          </div>
        ) : null}
        {onQrVerifyChange && outputType !== "closure_note" && outputType !== "receipt" ? (
          <label style={{ fontSize: 12, color: "var(--mut)", display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={qrVerifyEnabled}
              onChange={(e) => onQrVerifyChange(e.target.checked)}
            />
            QR verify zone
          </label>
        ) : null}
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
          ref={textareaRef}
          aria-label={`${canvasTitle(outputType)} template body`}
          data-testid="template-body"
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
        <div>
          {samplePreviewBanner ? (
            <p
              data-testid="sample-preview-banner"
              style={{ margin: "0 0 8px", fontSize: 12, color: "var(--mut)" }}
            >
              {samplePreviewBanner}
            </p>
          ) : null}
          <div
            aria-label={`${canvasTitle(outputType)} preview`}
            data-testid="template-preview"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: "top left",
              width: mmWidth,
              minHeight: mmHeight,
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-sm)",
              boxShadow: "var(--shadow-sm)",
              padding: 16,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                borderBottom: "1px solid var(--line)",
                paddingBottom: 8,
                marginBottom: 12,
                fontSize: 11,
                color: "var(--mut)",
              }}
            >
              Letterhead · tenant logo · {canvasTitle(outputType)}
            </div>
            <div style={{ flex: 1, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5 }}>
              {preview || `Start typing your ${canvasTitle(outputType).toLowerCase()} text…`}
            </div>
            <div
              style={{
                marginTop: 16,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
                fontSize: 11,
                color: "var(--mut)",
                gap: 8,
              }}
            >
              <span data-testid="preview-signatory">
                {signatoryLabel?.trim() ? signatoryLabel : "Signatory (not set)"}
              </span>
              {qrVerifyEnabled && outputType !== "closure_note" && outputType !== "receipt" ? (
                <span data-testid="preview-qr">QR verify</span>
              ) : (
                <span style={{ opacity: 0.5 }}>No QR</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
