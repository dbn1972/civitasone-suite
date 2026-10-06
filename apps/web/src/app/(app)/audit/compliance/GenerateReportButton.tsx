"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditComplianceItem } from "@civitasone/types";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { complianceCounts } from "./complianceModel";

/**
 * NOTE: audit-service exposes no server-side "compliance report" generator
 * (only GET /v1/audit/compliance and POST .../compliance/checklists). Until a
 * report endpoint exists, this assembles a client-side snapshot of the currently
 * loaded compliance posture and downloads it as JSON. Swap to the signed
 * /audit/exports pipeline once a compliance-scoped report job is added server-side.
 *
 * GAP-AUDIT-COMPLIANCE-02: because this file is NOT a signed/audited artifact,
 * it now requires an explicit confirmation that names the file as an unsigned
 * snapshot before anything is downloaded — auditors must not mistake it for a
 * provenance-bearing export (that is what /audit/exports is for).
 */
export function GenerateReportButton({ items }: { items: AuditComplianceItem[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // GAP-AUDIT-COMPLIANCE-06: keep the toast timer in a ref and clear it on
  // unmount so we never set state after the component has gone away.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const showToast = useCallback((text: string) => {
    setMsg(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMsg(null), 5000);
  }, []);

  const download = useCallback(() => {
    const counts = complianceCounts(items);
    const report = {
      generatedAt: new Date().toISOString(),
      kind: "compliance-snapshot",
      note: "Client-side snapshot — not a signed server artifact (no compliance report endpoint yet).",
      summary: {
        total: counts.total,
        complied: counts.complied,
        pending: counts.pending,
        overdue: counts.overdue,
        na: counts.na,
        openActions: counts.openActions,
        compliancePct: counts.scorePct,
      },
      items,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Unsigned snapshot of ${counts.total} requirements downloaded.`);
  }, [items, showToast]);

  return (
    <>
      <Button onClick={() => setConfirmOpen(true)}>Download snapshot (unsigned)</Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Download an unsigned snapshot?"
        description={
          <>
            This downloads the compliance posture currently on screen as a plain JSON
            file. It is <strong>not</strong> a signed or audited artifact and carries no
            provenance — do not submit it as compliance evidence. For a verifiable,
            signed export use the Export Jobs console instead.
          </>
        }
        confirmLabel="Download unsigned snapshot"
        cancelLabel="Cancel"
        onConfirm={() => {
          setConfirmOpen(false);
          download();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
      {msg && (
        <span
          role="status"
          aria-live="polite"
          style={{ position: "fixed", bottom: 18, right: 18, display: "inline-flex", alignItems: "center", gap: 8, background: "var(--goodbg)", color: "var(--good)", border: "1px solid var(--goodbd)", borderRadius: 8, padding: "8px 12px", fontSize: 13, zIndex: 100 }}
        >
          {msg}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              if (timerRef.current) clearTimeout(timerRef.current);
              setMsg(null);
            }}
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </span>
      )}
    </>
  );
}
