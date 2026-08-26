"use client";

import { DataTable } from "../../../../../_components/ds";
import { formatMoney } from "@/lib/formatters";

type BillLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: string;
  taxCode?: string;
} & Record<string, unknown>;

export function BillLineItemsTable({ rows }: { rows: BillLineItem[] }) {
  return (
    <DataTable<BillLineItem>
      columns={[
        { key: "description", label: "Description" },
        { key: "quantity", label: "Qty", align: "right" },
        {
          key: "unitPrice",
          label: "Unit Price",
          align: "right",
          render: (item) => (
            <span aria-label={`Unit price ${formatMoney(item.unitPrice as number)}`}>
              {formatMoney(item.unitPrice as number)}
            </span>
          ),
        },
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
        { key: "taxCode", label: "Tax Code", render: (item) => (item.taxCode as string | undefined) ?? "—" },
      ]}
      rows={rows}
    />
  );
}
