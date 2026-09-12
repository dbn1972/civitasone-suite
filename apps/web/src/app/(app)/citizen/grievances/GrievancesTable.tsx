"use client";

import { useTranslations } from "next-intl";
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

type ClockLabels = {
  closed: string;
  overdueBy: (count: number) => string;
  dueToday: string;
  daysLeft: (count: number) => string;
};

/** Statutory clock cell — colour AND text (never colour alone, WCAG 1.4.1). */
function clockCell(row: GrievanceRow, labels: ClockLabels) {
  if (CLOSED_STATUSES.has(row.status.toLowerCase())) {
    return <span style={{ color: "var(--muted)" }}>{labels.closed}</span>;
  }
  const n = row.daysLeft;
  if (n === null) return <span style={{ color: "var(--muted)" }}>—</span>;
  if (n < 0) {
    return (
      <span style={{ color: "#b42318", fontWeight: 600 }}>
        {labels.overdueBy(Math.abs(n))}
      </span>
    );
  }
  if (n === 0) return <span style={{ color: "#b42318", fontWeight: 600 }}>{labels.dueToday}</span>;
  const color = n <= 7 ? "#b54708" : "#067647";
  return (
    <span style={{ color, fontWeight: n <= 7 ? 600 : 400 }}>
      {labels.daysLeft(n)}
    </span>
  );
}

export function GrievancesTable({ rows }: { rows: GrievanceRow[] }) {
  const t = useTranslations("grievances");
  const labels: ClockLabels = {
    closed: t("closed"),
    overdueBy: (count) => t("overdueBy", { count }),
    dueToday: t("dueToday"),
    daysLeft: (count) => t("daysLeft", { count }),
  };
  return (
    <DataTable<GrievanceRow>
      columns={[
        { key: "grievanceNo", label: t("colGrievanceNo") },
        { key: "subject", label: t("colSubject") },
        { key: "complainantName", label: t("colComplainant") },
        { key: "category", label: t("colCategory") },
        { key: "status", label: t("colStatus"), cellType: "status" },
        { key: "daysLeft", label: t("colDaysLeft"), render: (row: GrievanceRow) => clockCell(row, labels) },
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
