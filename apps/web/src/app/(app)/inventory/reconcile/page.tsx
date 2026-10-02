import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, EmptyState, Card, RefreshErrorState } from "../../../_components/ds";
import { getStockLedger, getStockItems } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { PrintExportButton } from "../../stock/_components/PrintExportButton";
import { STOCK_LEDGER_LIMIT, capNote } from "../_limits";
import { StockLedgerTable } from "./StockLedgerTable";

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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A date query value the stock-service accepts, else undefined (never forwarded unvalidated). */
function isoDate(v: string | undefined): string | undefined {
  return v && ISO_DATE.test(v) ? v : undefined;
}

const ITEM_PAGE = 200; // stock-service max page
const ITEM_PAGE_CAP = 10; // never walk more than 2000 items for a cosmetic join

/**
 * Item code/name for the ids on the ledger page. The service default is 50
 * items, so ask for its maximum and keep paging until every wanted id is
 * resolved or the list ends. Best-effort: a failure keeps what was loaded and
 * the table falls back to short ids.
 */
async function loadStockItemNames(wanted: Set<string>): Promise<Map<string, { itemCode: string; name: string }>> {
  const names = new Map<string, { itemCode: string; name: string }>();
  if (wanted.size === 0) return names;
  try {
    for (let page = 0; page < ITEM_PAGE_CAP; page++) {
      const res = await getStockItems({ limit: ITEM_PAGE, offset: page * ITEM_PAGE });
      const batch = res?.data ?? [];
      for (const it of batch) names.set(it.id, { itemCode: it.itemCode, name: it.name });
      const resolved = [...wanted].every((id) => names.has(id));
      if (res?.source === "error" || batch.length < ITEM_PAGE || resolved) break;
    }
  } catch {
    // names are cosmetic; the table still renders with short ids
  }
  return names;
}

export default async function InventoryReconcilePage({
  searchParams,
}: {
  searchParams?: { from?: string; to?: string };
}) {
  const from = isoDate(searchParams?.from);
  const to = isoDate(searchParams?.to);
  // GAP-INVENTORY-RECONCILE-05: the service default page is only 100 rows, so
  // ask for its maximum and say so when even that page is full.
  const { data: ledger, source } = await getStockLedger({ limit: STOCK_LEDGER_LIMIT, ...(from ? { from } : {}), ...(to ? { to } : {}) });

  // GAP-INVENTORY-RECONCILE-03: the ledger carries only an item id, so join the
  // stock item master for the real item code (SKU) and name. Best-effort: a
  // failed lookup keeps the mapper's short-id fallback.
  const stockItems = await loadStockItemNames(new Set(ledger.flatMap((e) => (e.itemId ? [e.itemId] : []))));
  const entries = ledger.map((e) => {
    const item = e.itemId ? stockItems.get(e.itemId) : undefined;
    return item ? { ...e, itemCode: item.itemCode, itemName: item.name } : e;
  });
  const hasEntries = entries.length > 0;

  const receipts = entries.filter((e) => e.type === "receipt");
  const issues = entries.filter((e) => e.type === "issue");
  const adjustments = entries.filter((e) => e.type === "adjustment");
  const transfers = entries.filter((e) => e.type === "transfer");

  // GAP-INVENTORY-RECONCILE-02: totals and Net use the SIGNED quantity, so a
  // stock-reducing adjustment/transfer lowers Net instead of inflating it.
  // Net sums EVERY row so it always reconciles to the table; rows with an
  // unrecognised voucher type are surfaced as their own "Unclassified" stat.
  const unclassified = entries.filter((e) => e.type === "other");
  const totalIn = receipts.reduce((s, e) => s + e.signedQuantity, 0);
  const totalOut = issues.reduce((s, e) => s - e.signedQuantity, 0);
  const netQty = entries.reduce((s, e) => s + e.signedQuantity, 0);

  const rows = entries as LedgerEntry[];
  const note = capNote(entries.length, STOCK_LEDGER_LIMIT, "stock ledger movements");

  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <Link href="/inventory">Inventory</Link>
      </nav>

      {/* GAP-INVENTORY-RECONCILE-01: this page sums ledger movements; it never compared them to a
          physical count or the item balance (the ledger is per-warehouse and the item balance is
          not), so it is titled for what it computes. Physical variances live under Cycle Counts. */}
      <PageHeader
        title="Stock Movements Summary"
        subtitle="Totals of receipts, issues and adjustments from the stock ledger. This is a movement summary, not a comparison with a physical count; see Cycle Counts for counted variances."
        actions={source === "error" ? <DataSourceBadge source={source} /> : <PrintExportButton label="Export / Print" documentTitle="Stock Movements Summary" />}
      />

      <form method="get" aria-label="Filter by posting date" style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", margin: "0 0 12px" }}>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          From
          <input type="date" name="from" defaultValue={from ?? ""} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          To
          <input type="date" name="to" defaultValue={to ?? ""} />
        </label>
        <button type="submit" className="btn">Apply</button>
        {from || to ? <Link href="/inventory/reconcile">Clear dates</Link> : null}
      </form>

      {source === "error" ? (
        // UX-013: previously `entries.length === 0 && source !== "error"`
        // was false on any load failure (second operand false regardless of
        // length), which fell through to the ELSE branch below and rendered
        // a full, silently-zeroed StatGrid + an empty ledger table -- pixel
        // identical to a genuinely reconciled, zero-movement ledger.
        <RefreshErrorState error={toHumanError("load", { area: "stock ledger" })} />
      ) : !hasEntries ? (
        <EmptyState
          icon="📦"
          title={from || to ? "No stock movements in this period" : "No stock movements yet"}
          message={from || to ? "Try a wider date range." : "Record receipts or issues in Stock to see them summarised here."}
        />
      ) : (
        <>
          {note ? (
            <p role="note" style={{ fontSize: 13, color: "#92400e", margin: "0 0 8px" }}>
              {note} Narrow the date range to see the rest; the totals below cover only the movements listed.
            </p>
          ) : null}
          <StatGrid>
            <StatCard icon="📥" iconBg="#ecfdf5" label="Total In (Qty)" value={totalIn.toLocaleString("en-IN")} />
            <StatCard icon="📤" iconBg="#fef2f2" label="Total Out (Qty)" value={totalOut.toLocaleString("en-IN")} />
            <StatCard icon="🔧" iconBg="#fffbeb" label="Adjustments" value={adjustments.length.toLocaleString("en-IN")} />
            <StatCard icon="🔁" iconBg="#eff6ff" label="Transfers" value={transfers.length.toLocaleString("en-IN")} />
            {unclassified.length > 0 ? (
              <StatCard icon="❔" iconBg="#f1f5f9" label="Unclassified rows" value={unclassified.length.toLocaleString("en-IN")} />
            ) : null}
            <StatCard
              icon="⚖️"
              iconBg="#eff6ff"
              label="Net Movement (Qty)"
              value={netQty.toLocaleString("en-IN")}
              up={netQty >= 0}
            />
          </StatGrid>

          <Card title="Stock ledger">
            <StockLedgerTable rows={rows} />
          </Card>
        </>
      )}
    </div>
  );
}
