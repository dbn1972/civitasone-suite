"use client";

import { DataTable } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import type { AdjustmentRegisterRow } from "./page";

type Row = AdjustmentRegisterRow & { fromFy: string; toFy: string };

/**
 * GAP-REVENUE-ADJUSTMENTS-02: the adjustment register — date, from FY, to FY,
 * amount, reason — so an officer can see what balance was moved. FY labels are
 * resolved from the demand list (id -> FY) passed by the page; unknown ids fall
 * back to a short id so a row never shows a bare UUID.
 */
export function AdjustmentRegister({
  adjustments,
  demandFyById,
}: {
  adjustments: AdjustmentRegisterRow[];
  demandFyById: Record<string, string>;
}) {
  const fy = (id: string | undefined) =>
    (id && demandFyById[id]) ?? (id ? `${id.slice(0, 8)}…` : "—");
  const rows: Row[] = adjustments.map((a) => ({ ...a, fromFy: fy(a.fromDemandId), toFy: fy(a.toDemandId) }));

  return (
    <DataTable<Row>
      columns={[
        { key: "createdAt", label: "Date", render: (r) => (r.createdAt ? formatIndianDate(r.createdAt) : "—") },
        { key: "fromFy", label: "From FY" },
        { key: "toFy", label: "To FY" },
        { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
        { key: "reason", label: "Reason" },
      ]}
      rows={rows}
      sortable
      pageSize={15}
      emptyIcon="🔀"
      emptyTitle="No adjustments yet"
      emptyMessage="Balance transfers between this assessee's demands will appear here."
    />
  );
}
