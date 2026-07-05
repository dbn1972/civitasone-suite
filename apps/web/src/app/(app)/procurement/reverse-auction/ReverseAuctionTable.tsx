"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { ReverseAuction } from "../../../_data/loaders";

type AuctionRow = {
  id: string;
  item: string;
  startPrice: string;
  currentLowest: string;
  bidders: string;
  timeRemaining: string;
  status: string;
} & Record<string, unknown>;

function formatAmount(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export function ReverseAuctionTable({ auctions, source = "api" }: { auctions: ReverseAuction[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<ReverseAuction[]>(
    "procurement.reverse_auctions",
    auctions,
    source,
    (d) => d.length === 0,
  );

  const tableRows = useMemo<AuctionRow[]>(
    () =>
      rows.map((a) => ({
        id: a.id,
        item: a.item,
        startPrice: formatAmount(a.startPrice),
        currentLowest: formatAmount(a.currentLowest),
        bidders: String(a.bidders),
        timeRemaining: a.timeRemaining || "—",
        status: a.status,
      })),
    [rows],
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title="Auction Events">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
        <EmptyState icon="🔨" title="No auctions found" message="Reverse auctions will appear here once created." />
      ) : (
        <DataTable<AuctionRow>
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder="Search item, status…"
          pageSize={15}
          exportable
          exportFilename="reverse-auctions"
          columns={[
            { key: "item", label: "Item" },
            { key: "startPrice", label: "Start Price (₹)", align: "right" },
            { key: "currentLowest", label: "Current Lowest (₹)", align: "right" },
            { key: "bidders", label: "Bidders", align: "center" },
            { key: "timeRemaining", label: "Time Remaining" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}
