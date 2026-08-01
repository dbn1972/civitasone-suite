"use client";

import { useState } from "react";
import { DataTable, Tabs, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge, type DataSource } from "@/app/_components/DataSourceBadge";
import { formatBps } from "@/lib/formatters";
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
          {trendsSource === "error" && <DataSourceBadge source="error" />}
          {trendRows.length === 0 ? (
            <EmptyState
              icon="📈"
              title="No trend data"
              message={`No demand or collection movements have been recorded for the ${granularity === "fy" ? "financial-year" : "monthly"} series yet.`}
            />
          ) : (
            <DataTable<(typeof trendRows)[number]>
              columns={[
                { key: "period", label: "Period" },
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
          {agingSource === "error" && <DataSourceBadge source="error" />}
          {buckets.length === 0 ? (
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
          {defaultersSource === "error" && <DataSourceBadge source="error" />}
          {defaulters.length === 0 ? (
            <EmptyState icon="🚩" title="No defaulters" message="No assessees have an outstanding balance." />
          ) : (
            <DataTable<DefaulterRow>
              columns={[
                { key: "rank", label: "Rank", align: "right" },
                { key: "assesseeId", label: "Assessee ID" },
                { key: "outstandingMinor", label: "Outstanding", align: "right", cellType: "amount" },
              ]}
              rows={defaulters}
              sortable
              filterable
              filterPlaceholder="Filter by assessee ID…"
              pageSize={15}
            />
          )}
        </>
      )}

      {active === "Forecast" && <ForecastPanel defaultGranularity={granularity} />}
    </div>
  );
}
