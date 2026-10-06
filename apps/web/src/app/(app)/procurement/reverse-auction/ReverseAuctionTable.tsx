"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, DataTable, StatGrid, StatCard, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";
import { formatMoney } from "@/lib/formatters";
import type { ReverseAuction } from "../../../_data/loaders";

type AuctionRow = {
  id: string;
  auctionNo: string;
  indentRef: string;
  item: string;
  startPrice: string;
  currentLowest: string;
  savings: string;
  bidders: string;
  countdown: string;
  status: string;
} & Record<string, unknown>;

const LIVE_STATUSES = new Set(["live", "active"]);
const REFRESH_MS = 15_000;

/**
 * GAP-PROCUREMENT-REVERSE-AUCTION-01: countdown from the real `endsAt` instant,
 * ticking client-side every second, so a "Live" auction's time left is never a
 * stale server string. Shows "Closed"/"Closing" for terminal/elapsed states.
 */
function formatCountdown(endsAtMs: number, status: string, nowMs: number): string {
  const s = status.trim().toLowerCase();
  if (["closed", "awarded", "cancelled"].includes(s)) return "Closed";
  const remaining = endsAtMs - nowMs;
  if (remaining <= 0) return "Closing";
  const totalSec = Math.floor(remaining / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

export function ReverseAuctionTable({ auctions, source = "api" }: { auctions: ReverseAuction[]; source?: "api" | "error" }) {
  const { data: seeded, provenance, offline, cachedAt } = useSeededResource<ReverseAuction[]>(
    "procurement.reverse_auctions",
    auctions,
    source,
    (d) => d.length === 0,
  );

  // Live rows go stale fast; refetch while any row is Live, and tick a clock
  // every second so the countdown decrements client-side.
  const [liveData, setLiveData] = useState<ReverseAuction[] | null>(null);
  const rows = liveData ?? seeded;
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const hasLive = useMemo(() => rows.some((a) => LIVE_STATUSES.has(a.status.trim().toLowerCase())), [rows]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!hasLive) return;
    let cancelled = false;
    const t = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch("/api/proxy/v1/procurement/reverse-auctions", { cache: "no-store" });
          if (!res.ok || cancelled) return;
          const body = (await res.json()) as { data?: ReverseAuction[] };
          if (!cancelled && Array.isArray(body?.data)) {
            setLiveData(body.data);
            setUpdatedAt(Date.now());
          }
        } catch {
          /* transient refresh failure: keep showing the last good data */
        }
      })();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [hasLive]);

  const stats = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase();
    const live = rows.filter((a) => LIVE_STATUSES.has(norm(a.status))).length;
    const scheduled = rows.filter((a) => norm(a.status) === "scheduled").length;
    const awarded = rows.filter((a) => norm(a.status) === "awarded").length;
    // GAP-PROCUREMENT-REVERSE-AUCTION-05: total savings across all rows, BigInt.
    const savingsMinor = rows.reduce((s, a) => {
      try { return s + BigInt(a.savingsMinor); } catch { return s; }
    }, 0n);
    return { live, scheduled, awarded, total: rows.length, savingsMinor };
  }, [rows]);

  const errorNoData = provenance === "error-no-data";

  const tableRows = useMemo<AuctionRow[]>(
    () =>
      rows.map((a) => {
        let savings = "0";
        try {
          const sav = BigInt(a.savingsMinor);
          savings = formatMoney(sav.toString());
        } catch {
          savings = formatMoney(a.savingsMinor);
        }
        return {
          id: a.id,
          auctionNo: a.auctionNo,
          indentRef: a.indentRef,
          item: a.item,
          startPrice: formatMoney(a.startPriceMinor),
          currentLowest: formatMoney(a.currentLowestMinor),
          savings,
          bidders: String(a.bidders),
          countdown: formatCountdown(new Date(a.endsAt).getTime(), a.status, nowMs),
          status: a.status,
        };
      }),
    [rows, nowMs],
  );

  return (
    <>
      <StatGrid>
        <StatCard icon="🔨" tone="info" label="Live Auctions" value={errorNoData ? null : stats.live} />
        <StatCard icon="📅" tone="neutral" label="Scheduled" value={errorNoData ? null : stats.scheduled} />
        {/* GAP-PROCUREMENT-REVERSE-AUCTION-05: a neutral icon (not 💰) for a count. */}
        <StatCard icon="📋" tone="neutral" label="Total Events" value={errorNoData ? null : stats.total} />
        <StatCard icon="💰" tone="good" label="Total Savings" value={errorNoData ? null : formatMoney(stats.savingsMinor.toString())} />
      </StatGrid>

      <Card title="Auction Events">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <DataSourceBadge
            provenance={provenance ?? "live"}
            cachedAt={cachedAt}
            offline={offline}
            message={errorNoData ? "Couldn't load — showing nothing" : undefined}
          />
          {updatedAt ? (
            <span aria-live="polite" style={{ fontSize: 12, color: "var(--muted)" }}>
              Updated {new Date(updatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}
            </span>
          ) : null}
        </div>
        {errorNoData ? (
          <RefreshErrorState error={toHumanError("load", { area: "reverse auctions" })} />
        ) : tableRows.length === 0 ? (
          <DataTable<AuctionRow>
            rows={[]}
            columns={[]}
            emptyIcon="🔨"
            emptyTitle="No auctions found"
            emptyMessage="Reverse auctions will appear here once created."
          />
        ) : (
          <DataTable<AuctionRow>
            rows={tableRows}
            rowLinkKey="id"
            rowLinkPrefix="/procurement/reverse-auction/"
            identifyingColumnKey="auctionNo"
            sortable
            filterable
            filterPlaceholder="Search auction, item, status…"
            pageSize={15}
            exportable
            exportFilename="reverse-auctions"
            columns={[
              { key: "auctionNo", label: "Auction No" },
              { key: "item", label: "Item" },
              { key: "startPrice", label: "Start Price", align: "right" },
              { key: "currentLowest", label: "Current Lowest", align: "right" },
              { key: "savings", label: "Savings", align: "right" },
              { key: "bidders", label: "Bidders", align: "center" },
              { key: "countdown", label: "Time Remaining" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
          />
        )}
      </Card>
    </>
  );
}
