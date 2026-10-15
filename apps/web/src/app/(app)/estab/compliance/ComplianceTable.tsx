"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DataTable, Segmented, ActionButton, StatusPill } from "@/app/_components/ds";
import { humanizeStatus } from "@/lib/formatters";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";

export type ComplianceRow = {
  id: string;
  title: string;
  category: string;
  assignedTo: string | null; // GAP-ESTAB-COMPLIANCE-04: name; null → "—"; "" → Unknown employee
  due: string;
  status: string;
  statusRaw: string;
};

// GAP-ESTAB-COMPLIANCE-05: segments for every stat tile, not just All + Overdue.
const SEGMENT_MAP: Record<string, string | null> = {
  All: null,
  Open: "pending",
  Overdue: "overdue",
  Complied: "complied",
};
const SEGMENTS = Object.keys(SEGMENT_MAP);

export function ComplianceTable({ rows, canComply = false }: { rows: ComplianceRow[]; canComply?: boolean }) {
  const router = useRouter();
  const tFallback = useTranslations("employeeFallback");
  const [seg, setSeg] = useState("All");
  const [error, setError] = useState("");

  const statusFilter = SEGMENT_MAP[seg] ?? null;
  const filtered = statusFilter ? rows.filter((r) => r.statusRaw === statusFilter) : rows;

  // GAP-ESTAB-COMPLIANCE-03: mark a compliance item complied.
  const markComplied = useCallback(
    async (id: string, reason?: string) => {
      const res = await fetch(`/api/proxy/v1/estab/compliance/${id}/comply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ remarks: reason }),
      });
      if (!res.ok) {
        // Never surface the raw response body: map status/code to the standard copy.
        throw await userFacingErrorFromResponse(res, "save", "compliance item");
      }
      setError("");
      router.refresh();
    },
    [router],
  );

  return (
    <>
      <div className="card-h">
        <h3>
          Compliance items
          {statusFilter ? ` — ${humanizeStatus(statusFilter)} (${filtered.length})` : ` (${rows.length})`}
        </h3>
        <Segmented options={SEGMENTS} value={seg} onChange={setSeg} />
      </div>
      {error ? <p role="alert" style={{ color: "var(--bad)", padding: "8px 16px", fontSize: 13 }}>{error}</p> : null}
      <DataTable<ComplianceRow>
        columns={[
          { key: "title", label: "Action" },
          { key: "category", label: "Category" },
          {
            key: "assignedTo",
            label: "Assigned to",
            // GAP-ESTAB-COMPLIANCE-04: show "—" for null
            render: (r) => <>{r.assignedTo === null ? "—" : r.assignedTo || tFallback("unknownEmployee")}</>,
          },
          { key: "due", label: "Due" },
          {
            key: "status",
            label: "Status",
            render: (r) => <StatusPill status={r.statusRaw} />,
          },
          // GAP-ESTAB-COMPLIANCE-03: only viewers the service lets comply (estab officers)
          // get the action column; an audit officer reads the register without a dead button.
          ...(canComply ? [{
            key: "id" as const,
            label: "Action",
            sortable: false,
            render: (r: ComplianceRow) =>
              r.statusRaw !== "complied" ? (
                <ActionButton
                  label="Mark complied"
                  className="btn ghost"
                  confirmTitle={`Mark "${r.title}" as complied?`}
                  confirmDescription="This records the compliance and cannot be undone from this page."
                  confirmLabel="Mark complied"
                  requireReason
                  reasonLabel="Compliance remarks"
                  onConfirm={(reason) => markComplied(r.id, reason)}
                />
              ) : (
                <span style={{ color: "var(--mut)" }}>✔</span>
              ),
          }] : []),
        ]}
        rows={filtered}
        sortable
        filterable
        filterPlaceholder="Filter actions…"
        pageSize={10}
      />
    </>
  );
}
