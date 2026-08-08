"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { StatutoryReference } from "@/app/(app)/designer/_data/designerApi";

export interface StatutoryWarningDialogProps {
  open: boolean;
  packName: string;
  references: StatutoryReference[];
  /** Optional authority / jurisdiction scope shown under the refs list. */
  authorityScope?: string;
  crossTenant?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function StatutoryWarningDialog({
  open,
  packName,
  references,
  authorityScope,
  crossTenant = false,
  busy = false,
  onConfirm,
  onCancel,
}: StatutoryWarningDialogProps) {
  const ackId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) setAcknowledged(false);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(16,24,40,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="statutory-dialog-title"
        style={{
          width: "min(520px, 100%)",
          background: "var(--panel)",
          borderRadius: "var(--r-sm)",
          border: "1px solid var(--line)",
          padding: 20,
          boxShadow: "var(--shadow-md)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="statutory-dialog-title" style={{ margin: "0 0 8px", fontSize: 18 }}>
          Statutory references
        </h2>
        <p style={{ margin: "0 0 12px", color: "var(--ink2)", fontSize: 14 }}>
          <strong>{packName}</strong> references the following legislation. Review before importing.
        </p>
        <ul style={{ margin: "0 0 12px", paddingLeft: 20, fontSize: 14 }}>
          {references.map((ref) => (
            <li key={`${ref.act}-${ref.section ?? ""}`}>
              {ref.act}{ref.section ? ` — §${ref.section}` : ""}
              {ref.url ? (
                <> · <Link href={ref.url} target="_blank" rel="noreferrer">Reference</Link></>
              ) : null}
            </li>
          ))}
        </ul>
        {authorityScope ? (
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink2)" }}>
            Authority scope: <strong>{authorityScope}</strong>. Confirm your office is empowered
            under this jurisdiction before publishing locally.
          </p>
        ) : null}
        {crossTenant ? (
          <p style={{ color: "var(--warn-fg)", fontSize: 13 }}>
            Cross-tenant import requires Platform Admin acknowledgment.
          </p>
        ) : null}
        <label
          htmlFor={ackId}
          style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginBottom: 16 }}
        >
          <input
            id={ackId}
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span>
            I have reviewed the statutory references and authority scope for this import.
          </span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!acknowledged || busy}
            onClick={onConfirm}
          >
            {busy ? "Importing…" : "Import as draft"}
          </button>
        </div>
      </div>
    </div>
  );
}
