"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { DataTable, Segmented, EmptyState } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

interface LedgerEntry {
  id: string;
  date: string;
  itemCode: string;
  itemName: string;
  party?: string | null;
  quantity: number;
  /** qtyIn - qtyOut: positive = inbound, negative = outbound (GAP-STOCK-LEDGER-04). */
  signedQuantity: number;
  type: string;
  balance: number;
  totalValue: number;
  /** Short audit reference (GAP-STOCK-LEDGER-07). */
  referenceNo?: string;
}

interface Props {
  entries: LedgerEntry[];
}

// GAP-STOCK-LEDGER-06: transfers and adjustments are now filterable.
const SEG_OPTIONS = ["All", "Receipts", "Issues", "Transfers", "Adjustments"];

const SEG_TYPE_MAP: Record<string, string> = {
  Receipts: "receipt",
  Issues: "issue",
  Transfers: "transfer",
  Adjustments: "adjustment",
};

const COLUMNS = [
  { key: "ref" as const, label: "Ref" },
  { key: "date" as const, label: "Date" },
  { key: "item" as const, label: "Item" },
  { key: "warehouse" as const, label: "Warehouse" },
  { key: "quantityDisplay" as const, label: "Qty", align: "right" as const },
  { key: "type" as const, label: "Type", cellType: "status" as const },
  { key: "balance" as const, label: "Balance qty", align: "right" as const },
];

const UNRESOLVED = "—";
function ledgerItemLabel(code: string, name: string, unknownLabel: string): string {
  const hasCode = code.trim() !== "" && code !== UNRESOLVED;
  const hasName = name.trim() !== "" && name !== UNRESOLVED;
  if (hasCode && hasName) return `${code} ${name}`;
  if (hasName) return name;
  if (hasCode) return code;
  return unknownLabel;
}

export function StockLedgerClient({ entries }: Props) {
  const t = useTranslations("stockLedger");
  const [active, setActive] = useState("All");

  const filterType = SEG_TYPE_MAP[active];
  const segFiltered = filterType
    ? entries.filter((e) => e.type === filterType)
    : entries;

  const rows = segFiltered.map((entry) => {
    // GAP-STOCK-LEDGER-04: derive sign from signedQuantity, not from voucher type.
    const sign = entry.signedQuantity < 0 ? "−" : "+";
    const absQty = Math.abs(entry.signedQuantity);
    return {
      id: entry.id,
      // GAP-STOCK-LEDGER-07: show short reference for audit queries.
      ref: entry.referenceNo ?? "—",
      date: formatIndianDate(entry.date),
      // GAP-STOCK-LEDGER-03: show SKU + name from the item register; when the service could not
      // resolve them the mapper yields "—", which reads as "Unknown item" (never an id fragment).
      item: ledgerItemLabel(entry.itemCode, entry.itemName, t("unknownItem")),
      warehouse: entry.party ?? "—",
      quantityDisplay: `${sign}${absQty.toLocaleString("en-IN")}`,
      type: entry.type,
      balance: entry.balance.toLocaleString("en-IN"),
    };
  });

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
