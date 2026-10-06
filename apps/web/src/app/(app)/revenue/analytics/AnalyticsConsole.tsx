"use client";

import { useState } from "react";
import { DataTable, Tabs, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import type { DataSource } from "@/app/_components/DataSourceBadge";
import { formatBps, formatRevenuePeriod } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { ForecastPanel } from "./ForecastPanel";
import type { TrendRow, AgingBuckets, AgingBucketRow, DefaulterRow } from "./types";

const TABS = ["Trends & Efficiency", "Arrears Aging", "Top Defaulters", "Forecast"] as const;
type Tab = (typeof TABS)[number];

interface AnalyticsConsoleProps {
  granularity: string;
  trends: TrendRow[];
  trendsSource: DataSource;
  aging: AgingBuckets | null;
  agingSource: DataSource;
  defaulters: DefaulterRow[];
  defaultersSource: DataSource;
}

function agingRows(aging: AgingBuckets | null): AgingBucketRow[] {
  if (!aging) return [];
  return [
    { bucket: "0–30 days", outstandingMinor: aging.bucket0_30 },
    { bucket: "31–60 days", outstandingMinor: aging.bucket31_60 },
    { bucket: "61–90 days", outstandingMinor: aging.bucket61_90 },
    { bucket: "90+ days", outstandingMinor: aging.bucket90Plus },
  ];
}

export function AnalyticsConsole({
  granularity,
  trends,
  trendsSource,
  aging,
  agingSource,
  defaulters,
  defaultersSource,
}: AnalyticsConsoleProps) {
  const [active, setActive] = useState<Tab>("Trends & Efficiency");
  const trendRows = trends.map((t) => ({ ...t, efficiencyDisplay: formatBps(t.efficiencyBps) }));
  const buckets = agingRows(aging);

  return (
    <div>
      <Tabs tabs={[...TABS]} active={active} onChange={(t) => setActive(t as Tab)} />

      {active === "Trends & Efficiency" && (
        <>
          {trendsSource === "error" ? (
            <RefreshErrorState error={toHumanError("load", { area: "trend data" })} backHref="/revenue" />
          ) : trendRows.length === 0 ? (
            <EmptyState
              icon="📈"
              title="No trend data"
              message={`No demand or collection movements have been recorded for the ${granularity === "fy" ? "financial-year" : "monthly"} series yet.`}
            />
          ) : (
            <DataTable<(typeof trendRows)[number]>
              columns={[
                { key: "period", label: "Period", render: (r) => formatRevenuePeriod(r.period, granularity) },
                { key: "demandMinor", label: "Demand", align: "right", cellType: "amount" },
                { key: "collectionMinor", label: "Collection", align: "right", cellType: "amount" },
                { key: "efficiencyDisplay", label: "Efficiency", align: "right" },
              ]}
              rows={trendRows}
              sortable
              pageSize={15}
            />
          )}
        </>
      )}

      {active === "Arrears Aging" && (
        <>
          {agingSource === "error" ? (
            <RefreshErrorState error={toHumanError("load", { area: "arrears aging data" })} backHref="/revenue" />
          ) : buckets.length === 0 ? (
            <EmptyState icon="⏳" title="No arrears aging data" message="No outstanding demand balances were found." />
          ) : (
            <DataTable<AgingBucketRow>
              columns={[
                { key: "bucket", label: "Age Bucket" },
                { key: "outstandingMinor", label: "Outstanding", align: "right", cellType: "amount" },
              ]}
              rows={buckets}
            />
          )}
        </>
      )}

      {active === "Top Defaulters" && (
        <>
          {defaultersSource === "error" ? (
            <RefreshErrorState error={toHumanError("load", { area: "top defaulters" })} backHref="/revenue" />
          ) : defaulters.length === 0 ? (
            <EmptyState icon="🚩" title="No defaulters" message="No assessees have an outstanding balance." />
          ) : (
            <DataTable<DefaulterRow>
              columns={[
                { key: "ownerName", label: "Owner" },
                { key: "rank", label: "Rank", align: "right" },
                { key: "identifierNo", label: "Identifier No" },
                { key: "outstandingMinor", label: "Outstanding", align: "right", cellType: "amount" },
              ]}
              rows={defaulters}
              sortable
              filterable
              filterPlaceholder="Filter by owner or identifier…"
              rowLinkKey="assesseeId"
              rowLinkPrefix="/revenue/assessees/"
              identifyingColumnKey="ownerName"
              pageSize={15}
            />
          )}
        </>
      )}

      {active === "Forecast" && <ForecastPanel defaultGranularity={granularity} />}
    </div>
  );
}
