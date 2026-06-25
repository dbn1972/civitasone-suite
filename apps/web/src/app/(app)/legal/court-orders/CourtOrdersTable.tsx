"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataTable, Segmented, StatusPill } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import type { CourtOrderSummary } from "@civitasone/types";

type Row = CourtOrderSummary & Record<string, unknown>;

const FILTERS = ["All", "Due", "Risk"] as const;

function isOverdue(o: CourtOrderSummary, today: string): boolean {
  return Boolean(
    o.complianceRequired && o.status === "pending" && o.complianceDeadline && o.complianceDeadline <= today,
  );
}

function orderStatusPill(o: CourtOrderSummary, today: string): ReactNode {
  if (o.status === "complied") return <span className="pill good">Complied</span>;
  if (isOverdue(o, today)) return <span className="pill bad">Overdue</span>;
  if (o.status === "pending") return <span className="pill warn">Compliance due</span>;
  if (o.status === "appealed") return <span className="pill info">Under compliance</span>;
  if (o.status === "stayed") return <span className="pill mut">Stayed</span>;
  return <StatusPill status={o.status} />;
}

export function CourtOrdersTable({ items, today }: { items: CourtOrderSummary[]; today: string }) {
  const [filter, setFilter] = useState<string>("All");

  const rows = useMemo<Row[]>(() => {
    const base = items as Row[];
    if (filter === "Due") return base.filter((o) => o.complianceRequired && o.status === "pending");
    if (filter === "Risk") return base.filter((o) => isOverdue(o, today));
    return base;
  }, [items, filter, today]);

  return (
    <div className="card">
      <div className="card-h">
        <h3>Court order compliance</h3>
        <Segmented options={[...FILTERS]} value={filter} onChange={setFilter} />
      </div>
      <DataTable<Row>
        columns={[
          { key: "caseNo", label: "Case", render: (r) => <span className="mono">{r.caseNo}</span> },
          { key: "summary", label: "Direction" },
          { key: "department", label: "Dept", render: (r) => <>{r.department ?? "—"}</> },
          { key: "complianceRequired", label: "Type", render: (r) => <>{r.complianceRequired ? "Issued" : "Stay"}</> },
          { key: "complianceDeadline", label: "Due", render: (r) => <>{r.complianceDeadline ? formatIndianDate(r.complianceDeadline) : "—"}</> },
          { key: "status", label: "Status", render: (r) => orderStatusPill(r, today) },
        ]}
        rows={rows}
        rowHref={(r) => `/legal/cases/${r.caseId}`}
        sortable
        filterable
        filterPlaceholder="Filter orders…"
        pageSize={15}
      />
    </div>
  );
}
