"use client";

import { DataTable } from "@/app/_components/ds";

export type QuarterRow = {
  id: string;
  quarterNo: string;
  quarterType: string;
  category: string;
  address: string | null;
  locality: string | null;
  carpetAreaSqft: number | null;
  status: string;
  condition: string;
  orgUnit: string | null;
  version: number;
} & Record<string, unknown>;

export function QuartersTable({ quarters }: { quarters: QuarterRow[] }) {
  const columns = [
    { key: "quarterNo" as const, label: "Quarter No." },
    { key: "quarterType" as const, label: "Type", render: (r: QuarterRow) => r.quarterType.replace(/_/g, " ").toUpperCase() },
    { key: "category" as const, label: "Category" },
    { key: "locality" as const, label: "Locality", render: (r: QuarterRow) => r.locality ?? "—" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
    { key: "condition" as const, label: "Condition" },
  ];

  return (
    <DataTable<QuarterRow>
      columns={columns}
      rows={quarters}
      rowLinkKey="id"
      rowLinkPrefix="/estab/quarters/"
      sortable
      filterable
      filterPlaceholder="Filter by quarter no., type, category or locality…"
      pageSize={15}
      emptyIcon="🏘️"
      emptyTitle="No quarters yet"
      emptyMessage="Quarters added to the inventory will appear here."
    />
  );
}
