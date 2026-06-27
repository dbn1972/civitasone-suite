"use client";

import { DataTable } from "../../../_components/ds";

export interface GrievanceRow extends Record<string, unknown> {
  id: string;
  grievanceNo: string;
  subject: string;
  complainantName: string;
  category: string;
  status: string;
  daysLeft: number | null;
}

const CLOSED_STATUSES = new Set(["resolved", "closed", "disposed"]);

/** Statutory clock cell — colour AND text (never colour alone, WCAG 1.4.1). */
function clockCell(row: GrievanceRow) {
  if (CLOSED_STATUSES.has(row.status.toLowerCase())) {
    return <span style={{ color: "var(--muted)" }}>Closed</span>;
  }
  const n = row.daysLeft;
  if (n === null) return <span style={{ color: "var(--muted)" }}>—</span>;
  if (n < 0) {
    return (
      <span style={{ color: "#b42318", fontWeight: 600 }}>
        {`Overdue by ${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"}`}
      </span>
    );
  }
  if (n === 0) return <span style={{ color: "#b42318", fontWeight: 600 }}>Due today</span>;
  const color = n <= 7 ? "#b54708" : "#067647";
  return (
    <span style={{ color, fontWeight: n <= 7 ? 600 : 400 }}>
      {`${n} day${n === 1 ? "" : "s"} left`}
    </span>
  );
}

export function GrievancesTable({ rows }: { rows: GrievanceRow[] }) {
  return (
    <DataTable<GrievanceRow>
      columns={[
        { key: "grievanceNo", label: "Grievance No" },
        { key: "subject", label: "Subject" },
        { key: "complainantName", label: "Complainant" },
        { key: "category", label: "Category" },
        { key: "status", label: "Status", cellType: "status" },
        { key: "daysLeft", label: "Days Left", render: clockCell },
      ]}
      rows={rows}
      sortable
      filterable
      pageSize={15}
      rowLinkKey="id"
      rowLinkPrefix="/citizen/grievances/"
    />
  );
}
