"use client";

import { DataTable } from "../../../../../_components/ds";
import { formatMoney } from "@/lib/formatters";

// Minor units (paise) as a bigint-safe decimal string, matching
// SanctionDetailSchema.lineItems[].amount — pass straight to formatMoney().
type LineItem = { description: string; amount: string; head: string } & Record<string, unknown>;

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
            <span aria-label={`Amount ${formatMoney(item.amount as string)}`}>
              {formatMoney(item.amount as string)}
            </span>
          ),
        },
      ]}
      rows={rows}
    />
  );
}
