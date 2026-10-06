"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, Segmented, ActionButton, StatusPill } from "@/app/_components/ds";
import { humanizeStatus } from "@/lib/formatters";
import { UserFacingError } from "@/lib/userFacingError";

export type ComplianceRow = {
  id: string;
  title: string;
  category: string;
  assignedTo: string | null; // GAP-ESTAB-COMPLIANCE-04: null → "—"
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

export function ComplianceTable({ rows }: { rows: ComplianceRow[] }) {
  const router = useRouter();
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
        const body = await res.text().catch(() => "");
        throw UserFacingError.from({ message: body || "Failed to mark complied" });
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
            render: (r) => <>{r.assignedTo ?? "—"}</>,
          },
          { key: "due", label: "Due" },
          {
            key: "status",
            label: "Status",
            render: (r) => <StatusPill status={r.statusRaw} />,
          },
          {
            key: "id",
            label: "Action",
            sortable: false,
            // GAP-ESTAB-COMPLIANCE-03: mark complied button for non-complied rows.
            render: (r) =>
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
          },
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
