"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DataTable, Segmented } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export type AllotmentRow = {
  id: string;
  quarterId: string;
  employeeRef: string;
  employeeName: string | null;
  quarterNo: string | null;
  designation: string | null;
  payLevel: string | null;
  eligibilityScore: number;
  appliedAt: string;
  status: string;
  version: number;
  /** GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-01: the last lifecycle command the server refused (code only). */
  lastCommandErrorCode?: string | null;
  lastCommandErrorCommand?: string | null;
  lastCommandErrorAt?: string | null;
} & Record<string, unknown>;

// GAP-ESTAB-QUARTERS-ALLOTMENTS-05: status filter segments (key -> i18n label key).
const STATUS_SEGMENTS: ReadonlyArray<readonly [string, string]> = [
  ["all", "allotSegAll"],
  ["applied", "allotSegApplied"],
  ["waitlisted", "allotSegWaitlisted"],
  ["allotted", "allotSegAllotted"],
  ["occupied", "allotSegOccupied"],
  ["vacation_notice", "allotSegVacationNotice"],
];

export function AllotmentsTable({ allotments }: { allotments: AllotmentRow[] }) {
  const tFallback = useTranslations("employeeFallback");
  const tP2 = useTranslations("estabP2");
  const [segment, setSegment] = useState("all");
  const visible = segment === "all" ? allotments : allotments.filter((a) => a.status === segment);
  const rows = visible.map((a) => {
    const unknownEmployee = tFallback("unknownEmployee");
    return {
      ...a,
      // GAP-ESTAB-QUARTERS-ALLOTMENTS-03: single Employee column with a
      // "Name unavailable" fallback when hrms enrichment fails, replacing
      // the duplicate Employee-ref column that showed the same truncated
      // UUID twice when name was null.
      employeeDisplay: a.employeeName ?? unknownEmployee,
      // GAP-ESTAB-QUARTERS-ALLOTMENTS-01: show the quarter number instead of
      // a truncated UUID prefix. The service now enriches `quarterNo`.
      quarterDisplay: a.quarterNo ?? "—",
      appliedDisplay: formatIndianDate(a.appliedAt),
    };
  });

  const columns = [
    { key: "employeeDisplay" as const, label: "Employee" },
    // GAP-ESTAB-QUARTERS-ALLOTMENTS-01: quarter number column (filterable).
    { key: "quarterDisplay" as const, label: "Quarter" },
    { key: "designation" as const, label: "Designation", render: (r: typeof rows[number]) => r.designation ?? "—" },
    { key: "payLevel" as const, label: "Pay Level", render: (r: typeof rows[number]) => r.payLevel ?? "—" },
    // GAP-ESTAB-QUARTERS-ALLOTMENTS-05: eligibility score, sortable.
    { key: "eligibilityScore" as const, label: "Eligibility" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
    { key: "appliedDisplay" as const, label: "Applied", sortable: false },
  ];

  return (
    <>
    <div style={{ margin: "0 16px 8px" }}>
      <Segmented
        options={STATUS_SEGMENTS.map(([value, key]) => ({ value, label: tP2(key) }))}
        value={segment}
        onChange={setSegment}
      />
    </div>
    <DataTable
      columns={columns}
      rows={rows}
      // GAP-ESTAB-QUARTERS-ALLOTMENTS-02: removed the unverifiable "current
      // financial year" claim. The data scope is whatever the service returns
      // (all time unless the service defaults to a FY).
      caption="Quarter allotments"
      rowLinkKey="id"
      rowLinkPrefix="/estab/quarters/allotments/"
      identifyingColumnKey="employeeDisplay"
      sortable
      filterable
      filterPlaceholder="Filter by employee, quarter, designation or status…"
      pageSize={15}
      emptyIcon="📋"
      emptyTitle="No allotment applications yet"
      emptyMessage="Applications employees submit for a quarter will appear here."
    />
    </>
  );
}
