"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "../../../../_components/ds";
import { AllocationDecisionButtons } from "./AllocationDecisionButtons";

export type AllocationTableRow = {
  id: string;
  person: string;
  target: string;
  pct: string;
  window: string;
  status: string;
  pending: boolean;
  requestedBy: string;
  label: string;
} & Record<string, unknown>;

/** Allocations list; approvers get Approve / Reject on pending rows (client component: per-row buttons). */
export function AllocationsTable({ rows, canDecide, currentUserId }: { rows: AllocationTableRow[]; canDecide: boolean; currentUserId: string | null }) {
  const t = useTranslations("projectCosting");
  return (
    <DataTable<AllocationTableRow>
      columns={[
        { key: "person", label: t("colEmployee") },
        { key: "target", label: t("colTarget") },
        { key: "pct", label: t("colPct"), align: "right" },
        { key: "window", label: t("colWindow") },
        { key: "status", label: t("colStatus") },
        ...(canDecide
          ? [{
              key: "actions", label: t("colActions"),
              render: (r: AllocationTableRow) => r.pending
                ? <AllocationDecisionButtons allocationId={r.id} requestedBy={r.requestedBy} currentUserId={currentUserId} label={r.label} />
                : null,
            }]
          : []),
      ]}
      rows={rows}
      sortable
      filterable
      filterPlaceholder={t("filterPlaceholder")}
      pageSize={15}
      emptyIcon="🧮"
      emptyTitle={t("allocationsEmptyTitle")}
      emptyMessage={t("allocationsEmptyMessage")}
    />
  );
}
