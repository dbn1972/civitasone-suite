"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
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
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<ReverseAuction[]>(
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

  return (
    <Card title="Auction Events">
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge
        provenance={provenance ?? "live"}
        cachedAt={cachedAt}
        offline={offline}
        message={provenance === "error-no-data" ? "Couldn't load — showing nothing" : undefined}
      />
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
