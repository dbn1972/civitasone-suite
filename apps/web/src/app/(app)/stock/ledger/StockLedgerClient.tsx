"use client";
import { useState } from "react";
import { DataTable, Segmented, EmptyState } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

interface LedgerEntry {
  id: string;
  date: string;
  itemCode: string;
  itemName: string;
  party?: string | null;
  quantity: number;
  type: string;
  balance: number;
  totalValue: number;
}

interface Props {
  entries: LedgerEntry[];
}

const SEG_OPTIONS = ["All", "Receipts", "Issues"];

const COLUMNS = [
  { key: "date" as const, label: "Date" },
  { key: "item" as const, label: "Item" },
  { key: "warehouse" as const, label: "Warehouse" },
  { key: "quantityDisplay" as const, label: "Qty", align: "right" as const },
  { key: "type" as const, label: "Type", cellType: "status" as const },
  { key: "balance" as const, label: "Balance", align: "right" as const },
];

export function StockLedgerClient({ entries }: Props) {
  const [active, setActive] = useState("All");

  const segFiltered =
    active === "Receipts"
      ? entries.filter((e) => e.type === "receipt")
      : active === "Issues"
      ? entries.filter((e) => e.type === "issue")
      : entries;

  const rows = segFiltered.map((entry) => ({
    id: entry.id,
    date: formatIndianDate(entry.date),
    item: `${entry.itemCode} ${entry.itemName}`,
    warehouse: entry.party ?? "—",
    quantityDisplay: `${entry.type === "issue" ? "-" : "+"}${entry.quantity.toLocaleString("en-IN")}`,
    type: entry.type,
    balance: entry.balance.toLocaleString("en-IN"),
  }));

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-h">
        <h3>Stock ledger</h3>
        <div role="group" aria-label="Filter by entry type">
          <Segmented value={active} onChange={setActive} options={SEG_OPTIONS} />
        </div>
      </div>
      {entries.length === 0 ? (
        <EmptyState icon="📋" title="No ledger entries" message="Stock movements will appear here." />
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          sortable
          filterable
          pageSize={15}
        />
      )}
    </div>
  );
}
