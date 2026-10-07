"use client";
/**
 * GAP-AI-COPILOT-DETAIL-03: a copilot prompt/response is free text that may
 * contain an Aadhaar, PAN or similar identifier typed by a user. It used to be
 * printed verbatim to anyone with access to the module. This renders the text
 * with detected identifiers masked by default and an explicit, honest toggle to
 * show the original.
 *
 * IMPORTANT: the masking is ADVISORY (regex, best-effort — see lib/pii.ts) and
 * the "show original" toggle is purely client-side. There is no server-audited
 * reveal endpoint for copilot turns, so this component deliberately does NOT
 * claim the reveal is logged (that would be a false assurance). It only reduces
 * casual over-exposure of stored text on screen.
 */
import { useState } from "react";
import { detectIdentifiers, maskIdentifiers } from "@/lib/pii";

export interface MaskablePromptTextProps {
  text: string;
  /** Accessible noun for the toggle, e.g. "prompt" or "response". */
  label: string;
}

export function MaskablePromptText({ text, label }: MaskablePromptTextProps) {
  const hasPii = detectIdentifiers(text);
  const [revealed, setRevealed] = useState(false);
  const shown = hasPii && !revealed ? maskIdentifiers(text) : text;

  return (
    <div style={{ padding: "12px 16px" }}>
      <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14 }}>{shown}</p>
      {hasPii ? (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn ghost"
            style={{ padding: "0 10px", fontSize: 12, minHeight: 32 }}
            aria-pressed={revealed}
            onClick={() => setRevealed((v) => !v)}
          >
            {revealed ? `Hide identifiers in ${label}` : `Show original ${label}`}
          </button>
          <span style={{ fontSize: 12, color: "var(--muted, #64748b)", marginInlineStart: 10 }}>
            Identity numbers are hidden here. This on-screen hiding is advisory only.
          </span>
        </div>
      ) : null}
    </div>
  );
}
