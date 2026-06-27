"use client";

import { DataTable } from "../../../../../_components/ds";
import { formatMoney } from "@/lib/formatters";

type LineItem = { description: string; amount: number; head: string } & Record<string, unknown>;

export function SanctionLineItemsTable({ rows }: { rows: LineItem[] }) {
  return (
    <DataTable<LineItem>
      columns={[
        { key: "description", label: "Description" },
        { key: "head", label: "Head" },
        {
          key: "amount",
          label: "Amount",
          align: "right",
          render: (item) => (
            <span aria-label={`Amount ${formatMoney(item.amount as number)}`}>
              {formatMoney(item.amount as number)}
            </span>
          ),
        },
      ]}
      rows={rows}
    />
  );
}
