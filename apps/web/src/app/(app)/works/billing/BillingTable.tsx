"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  { key: "billNo", label: "Bill No", sortable: true },
  { key: "work", label: "Work", sortable: true },
  { key: "mode", label: "Mode", sortable: true },
  { key: "gross", label: "Gross", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "netPayable", label: "Net Payable", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "stage", label: "Stage", sortable: true },
  { key: "status", label: "Status", cellType: "status" as const, sortable: true },
];

export function BillingTable({ bills, source }: { bills: Record<string, unknown>[]; source: string }) {
  const { data } = useSeededResource("works-billing", bills, source, bills.length === 0);

  return (
    <DataTable
      columns={columns}
      rows={data}
      sortable
      filterable
      filterPlaceholder="Search bills..."
      pageSize={15}
      exportable
      exportFilename="works-billing"
      emptyIcon="💰"
      emptyTitle="No bills found"
      emptyMessage="Works billing records will appear here."
    />
  );
}
