"use client";

import Link from "next/link";
import { DataTable } from "@/app/_components/ds";

type BoqRow = Record<string, unknown> & { id: string };

/**
 * The BoQ items of one work. GAP-WORKS-BILLING-MEASUREMENTS-NEW-02: when the viewer may record measurements, each
 * line gets a "Record measurement" action that opens the form with this work and this BoQ item already chosen, so
 * the clerk never has to find the item again. (Client component: the action column needs a render function, which
 * cannot cross from the server page.)
 */
export function BoqItemsTable({ rows, workId, canRecordMeasurement }: { rows: BoqRow[]; workId: string; canRecordMeasurement: boolean }) {
  const columns = [
    { key: "itemCode", label: "Item Code" },
    { key: "itemDescription", label: "Description" },
    { key: "unit", label: "Unit" },
    { key: "rate", label: "Rate ₹", cellType: "amount" as const, align: "right" as const },
    { key: "quantity", label: "Qty", align: "right" as const },
    { key: "amountMinor", label: "Amount ₹", cellType: "amount" as const, align: "right" as const },
    ...(canRecordMeasurement
      ? [
          {
            key: "id",
            label: "",
            csvExclude: true,
            render: (row: BoqRow) => (
              <Link
                href={`/works/billing/measurements/new?workId=${encodeURIComponent(workId)}&boqItemId=${encodeURIComponent(row.id)}`}
                className="btn ghost sm"
                aria-label={`Record measurement for ${String(row.itemCode ?? row.id)}`}
              >
                Record measurement
              </Link>
            ),
          },
        ]
      : []),
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      emptyIcon="📋"
      emptyTitle="No BoQ items"
      emptyMessage="No bill of quantities items have been added for this work yet."
      emptyAction={
        <Link href={`/works/boq/new?workId=${workId}`} className="btn primary">
          + Add first item
        </Link>
      }
    />
  );
}
