"use client";

import { useCallback, useState } from "react";
import type { AuditComplianceItem } from "@civitasone/types";

/**
 * NOTE: audit-service exposes no server-side "compliance report" generator
 * (only GET /v1/audit/compliance and POST .../compliance/checklists). Until a
 * report endpoint exists, this assembles a client-side snapshot of the currently
 * loaded compliance posture and downloads it as JSON. Swap to the signed
 * /audit/exports pipeline once a compliance-scoped report job is added server-side.
 */
export function GenerateReportButton({ items }: { items: AuditComplianceItem[] }) {
  const [msg, setMsg] = useState<string | null>(null);

  const generate = useCallback(() => {
    const complied = items.filter((i) => i.status === "complied").length;
    const report = {
      generatedAt: new Date().toISOString(),
      kind: "compliance-snapshot",
      note: "Client-side snapshot — not a signed server artifact (no compliance report endpoint yet).",
      summary: {
        total: items.length,
        complied,
        pending: items.filter((i) => i.status === "pending").length,
        overdue: items.filter((i) => i.status === "overdue").length,
        compliancePct: items.length ? Math.round((complied / items.length) * 100) : 0,
      },
      items,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg(`Snapshot of ${items.length} requirements downloaded.`);
    window.setTimeout(() => setMsg(null), 5000);
  }, [items]);

  return (
    <>
      <button type="button" className="btn primary" onClick={generate}>Generate Report</button>
      {msg && (
        <span role="status" aria-live="polite" style={{ position: "fixed", bottom: 18, right: 18, background: "var(--goodbg)", color: "var(--good)", border: "1px solid var(--goodbd)", borderRadius: 8, padding: "8px 12px", fontSize: 13, zIndex: 100 }}>
          {msg}
        </span>
      )}
    </>
  );
}
