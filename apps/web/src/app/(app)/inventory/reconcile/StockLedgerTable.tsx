"use client";

import { DataTable } from "../../../_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

type LedgerEntry = {
  id: string;
  itemCode: string;
  itemName: string;
  date: string;
  type: string;
  quantity: number;
  totalValue: number;
  referenceNo?: string;
  balance: number;
} & Record<string, unknown>;

const typeColors: Record<string, string> = {
  receipt: "good",
  issue: "bad",
  transfer: "info",
  adjustment: "warn",
};

export function StockLedgerTable({ rows }: { rows: LedgerEntry[] }) {
  return (
    <DataTable<LedgerEntry>
      columns={[
        { key: "itemCode", label: "Item Code", render: (e) => <span className="mono" style={{ color: "var(--primary)" }}>{e.itemCode as string}</span> },
        { key: "itemName", label: "Item Name" },
        { key: "date", label: "Date", render: (e) => formatIndianDate(e.date as string) },
        {
          key: "type",
          label: "Movement",
          render: (e) => (
            <span className={`pill ${typeColors[e.type as string] ?? "mut"}`} style={{ textTransform: "capitalize" }}>
              {e.type as string}
            </span>
          ),
        },
        {
          key: "quantity",
          label: "Quantity",
          align: "right",
          render: (e) => (
            <>{e.type === "issue" ? "-" : "+"}{(e.quantity as number).toLocaleString("en-IN")}</>
          ),
        },
        {
          key: "totalValue",
          label: "Value",
          align: "right",
          render: (e) => formatMoney(e.totalValue as number),
        },
        {
          key: "referenceNo",
          label: "Reference",
          render: (e) => <span className="mono" style={{ fontSize: 12, color: "var(--ink2)" }}>{(e.referenceNo as string | undefined) ?? "—"}</span>,
        },
        {
          key: "balance",
          label: "Balance",
          align: "right",
          render: (e) => <strong>{(e.balance as number).toLocaleString("en-IN")}</strong>,
        },
      ]}
      rows={rows}
      filterable
      filterPlaceholder="Search by item name or code…"
      pageSize={50}
      sortable
    />
  );
}
