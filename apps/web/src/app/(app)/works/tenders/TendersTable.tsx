"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  { key: "work", label: "Work", sortable: true },
  { key: "tenderType", label: "Tender Type", sortable: true },
  { key: "amount", label: "Amount", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "openingDate", label: "Opening Date", sortable: true },
  { key: "authority", label: "Authority", sortable: true },
  { key: "status", label: "Status", cellType: "status" as const, sortable: true },
];

export function TendersTable({ tenders, source }: { tenders: Record<string, unknown>[]; source: string }) {
  const { data } = useSeededResource("works-tenders", tenders, source, tenders.length === 0);

  return (
    <DataTable
      columns={columns}
      rows={data}
      sortable
      filterable
      filterPlaceholder="Search tenders..."
      pageSize={15}
      exportable
      exportFilename="works-tenders"
      emptyIcon="📢"
      emptyTitle="No tenders found"
      emptyMessage="Tender records will appear here once created."
    />
  );
}
