"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  { key: "itemCode", label: "Item Code", sortable: true },
  { key: "description", label: "Description", sortable: true },
  { key: "unit", label: "Unit", sortable: true },
  { key: "rate", label: "Rate", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "quantity", label: "Quantity", align: "right" as const, sortable: true },
  { key: "amount", label: "Amount", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "scope", label: "Scope", sortable: true },
];

export function BoqTable({ items, source }: { items: Record<string, unknown>[]; source: string }) {
  const { data } = useSeededResource("works-boq", items, source, items.length === 0);

  return (
    <DataTable
      columns={columns}
      rows={data}
      sortable
      filterable
      filterPlaceholder="Search BoQ items..."
      pageSize={15}
      exportable
      exportFilename="works-boq"
      emptyIcon="📐"
      emptyTitle="No BoQ items found"
      emptyMessage="Bill of Quantities items will appear here once a work is selected."
    />
  );
}
