"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, DataTable, EmptyState, StatGrid, StatCard, RefreshErrorState, Button } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatMoney, formatIndianDate, formatIndianDateTime } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import type { GemItem } from "../../../_data/loaders";
import { bucketCounts, countsAsSpend } from "./gemStatus";

type GemRow = {
  id: string;
  orderId: string;
  item: string;
  supplier: string;
  amount: string;
  deliveryDate: string;
  gemStatus: string;
} & Record<string, unknown>;

export function GemTable({
  items,
  source = "api",
  query = "",
  integrationDisabled = false,
  reason = null,
}: {
  items: GemItem[];
  source?: "api" | "error";
  query?: string;
  integrationDisabled?: boolean;
  reason?: string | null;
}) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState(query);
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GemItem[]>(
    "procurement.gem",
    items,
    source,
    (d) => d.length === 0,
  );
  const errored = provenance === "error-no-data";

  // GAP2-PROCUREMENT-GEM-ITEMS-08: push the typed search term into the URL (?q=)
  // so the server re-fetches against the live GeM catalog. An empty term clears
  // the query.
  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    const term = searchTerm.trim();
    router.push(term ? `/procurement/gem?q=${encodeURIComponent(term)}` : "/procurement/gem");
  }

  // GAP-PROCUREMENT-GEM-03: an honest "last updated" stamp — the cached copy's
  // timestamp when serving cache, otherwise the time this view was rendered.
  // Captured once on mount so it doesn't tick on every re-render.
  const [renderedAt] = useState(() => new Date().toISOString());
  const lastUpdated = provenance === "cached" && cachedAt ? cachedAt : renderedAt;

  const tableRows = useMemo<GemRow[]>(
    () =>
      rows.map((g) => ({
        id: g.id,
        orderId: g.orderId,
        item: g.item,
        supplier: g.supplier,
        // GAP-PROCUREMENT-GEM-02: formatMoney (BigInt paise, 2 decimals).
        amount: formatMoney(g.amount),
        deliveryDate: formatIndianDate(g.deliveryDate),
        gemStatus: g.gemStatus,
      })),
    [rows],
  );

  // GAP-PROCUREMENT-GEM-04: bucket every order so the counts reconcile to the
  // total; GAP-PROCUREMENT-GEM-02: Total Value sums only spend-bearing
  // (non-cancelled) orders, in integer paise.
  const counts = useMemo(() => bucketCounts(rows.map((g) => g.gemStatus)), [rows]);
  const spendPaise = useMemo(
    () => rows.filter((g) => countsAsSpend(g.gemStatus)).reduce((sum, g) => sum + g.amount, 0),
    [rows],
  );

  const totalOrders = errored ? "—" : counts.total;
  const delivered = errored ? "—" : counts.delivered;
  const inTransit = errored ? "—" : counts.inTransit;
  const otherCount = errored ? "—" : counts.cancelled + counts.other;
  const totalValue = errored ? "—" : formatMoney(spendPaise);

  return (
    <>
      <StatGrid>
        <StatCard icon="🛒" iconBg="#eef2ff" label="Total Orders" value={totalOrders} />
        <StatCard icon="📦" iconBg="#ecfdf3" label="Delivered" value={delivered} />
        <StatCard icon="🚚" iconBg="#fffaeb" label="In Transit" value={inTransit} />
        <StatCard icon="🗂️" iconBg="#f1f5f9" label="Other / Cancelled" value={otherCount} />
        <StatCard icon="💰" iconBg="#fce7ee" label="Total Value (excl. cancelled)" value={totalValue} />
      </StatGrid>

      <Card
        title="GeM Orders"
        link={
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {/* GAP-PROCUREMENT-GEM-03: an honest freshness stamp + a real
                refresh (re-runs the server fetch) — not a fabricated sync. */}
            {!errored ? (
              <span className="muted" style={{ fontSize: "12px" }} role="status">
                Last updated {formatIndianDateTime(lastUpdated)}
              </span>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => router.refresh()}>
              Refresh
            </Button>
          </div>
        }
      >
        {provenance === "cached" ? (
          <DataSourceBadge provenance="cached" cachedAt={cachedAt} offline={offline} />
        ) : null}

        {/* GAP2-PROCUREMENT-GEM-ITEMS-08: a real search box that drives ?q= —
            the live GeM catalog is only queried when a term is supplied. */}
        <form onSubmit={runSearch} role="search" style={{ display: "flex", gap: 8, margin: "0 0 12px" }}>
          <input
            type="search"
            aria-label="Search the GeM catalog"
            placeholder="Search the GeM catalog by item or keyword…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ flex: 1, minHeight: 40, padding: "0 10px" }}
          />
          <Button type="submit" variant="primary" size="sm">Search</Button>
        </form>

        {errored ? (
          // GAP-PROCUREMENT-GEM-01: a failed fetch is a real error with retry —
          // not "No GeM orders found" and not zeroed stats.
          <RefreshErrorState error={toHumanError("load", { area: "GeM orders" })} />
        ) : integrationDisabled && tableRows.length === 0 ? (
          // GAP2-PROCUREMENT-GEM-ITEMS-08: distinct from "no results" — the
          // integration itself is not configured, so searching cannot help. The
          // server's own `reason` is shown as a diagnostic when present.
          <EmptyState
            icon="🔌"
            title="GeM integration is not configured"
            message={reason ?? "The Government e-Marketplace connection has not been set up, so live catalogue items cannot be fetched. Contact your administrator to enable it."}
          />
        ) : !query && tableRows.length === 0 ? (
          // GAP2-PROCUREMENT-GEM-ITEMS-08: no term entered — tell the operator to
          // search, rather than showing a bare "no items" that reads as "none exist".
          <EmptyState
            icon="🔎"
            title="Enter a search term"
            message="Type an item or keyword above and press Search to query the live GeM catalogue."
          />
        ) : tableRows.length === 0 ? (
          <EmptyState icon="🛒" title="No GeM items found" message={`No GeM catalogue items matched “${query}”. Try a different search term.`} />
        ) : (
          <DataTable<GemRow>
            rows={tableRows}
            sortable
            filterable
            filterPlaceholder="Search order ID, item, supplier…"
            pageSize={15}
            exportable
            exportFilename="gem-orders"
            columns={[
              { key: "orderId", label: "GeM Order ID" },
              { key: "item", label: "Item" },
              { key: "supplier", label: "Supplier" },
              // GAP-PROCUREMENT-GEM-02: formatMoney prints ₹, so "Amount".
              { key: "amount", label: "Amount", align: "right" },
              { key: "deliveryDate", label: "Delivery Date" },
              { key: "gemStatus", label: "Status", cellType: "status" },
            ]}
          />
        )}
      </Card>
    </>
  );
}
