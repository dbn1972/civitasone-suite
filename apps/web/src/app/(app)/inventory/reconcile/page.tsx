import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, DataTable, EmptyState, Card } from "../../../_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getStockLedger } from "../../../_data/loaders";

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

export default async function InventoryReconcilePage() {
  const { data: entries, source } = await getStockLedger();

  const receipts = entries.filter((e) => e.type === "receipt");
  const issues = entries.filter((e) => e.type === "issue");
  const adjustments = entries.filter((e) => e.type === "adjustment");

  const totalIn = receipts.reduce((s, e) => s + e.quantity, 0);
  const totalOut = issues.reduce((s, e) => s + e.quantity, 0);
  const totalAdjusted = adjustments.reduce((s, e) => s + e.quantity, 0);
  const netQty = totalIn - totalOut + totalAdjusted;

  const rows = entries as LedgerEntry[];

  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <Link href="/inventory">Inventory</Link>
        <span aria-hidden="true"> › </span>
        <span aria-current="page">Reconciliation</span>
      </nav>

      <PageHeader
        title="Inventory Reconciliation"
        subtitle="Compare physical stock movements — receipts, issues and adjustments — to verify ledger balance."
        actions={source === "error" ? <DataSourceBadge source={source} /> : undefined}
      />

      {entries.length === 0 && source !== "error" ? (
        <EmptyState
          icon="📦"
          title="No stock movements to reconcile"
          message="Record receipts or issues in Stock to begin reconciliation."
        />
      ) : (
        <>
          <StatGrid>
            <StatCard icon="📥" iconBg="#ecfdf5" label="Total In (Qty)" value={totalIn.toLocaleString("en-IN")} />
            <StatCard icon="📤" iconBg="#fef2f2" label="Total Out (Qty)" value={totalOut.toLocaleString("en-IN")} />
            <StatCard icon="🔧" iconBg="#fffbeb" label="Adjustments" value={adjustments.length.toLocaleString("en-IN")} />
            <StatCard
              icon="⚖️"
              iconBg="#eff6ff"
              label="Net Balance (Qty)"
              value={netQty.toLocaleString("en-IN")}
              up={netQty >= 0}
            />
          </StatGrid>

          <Card title="Stock ledger">
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
          </Card>
        </>
      )}
    </div>
  );
}
