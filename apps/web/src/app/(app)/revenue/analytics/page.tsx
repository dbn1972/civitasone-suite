import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatBps, formatMoney } from "@/lib/formatters";
import { AnalyticsConsole } from "./AnalyticsConsole";
import type { TrendRow, EfficiencyKpi, AgingBuckets, DefaulterRow } from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function arrayFromPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: unknown[] }).data;
  }
  return null;
}

function mapTrends(payload: unknown): TrendRow[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: TrendRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const period = raw.period;
    if (typeof period !== "string") continue;
    mapped.push({
      period,
      demandMinor: String(raw.demandMinor ?? 0),
      collectionMinor: String(raw.collectionMinor ?? 0),
      efficiencyBps: typeof raw.efficiencyBps === "number" ? raw.efficiencyBps : Number(raw.efficiencyBps ?? 0),
    });
  }
  return mapped;
}

function mapEfficiency(payload: unknown): EfficiencyKpi | null {
  if (!isRecord(payload)) return null;
  const data = isRecord(payload.data) ? payload.data : payload;
  if (!isRecord(data)) return null;
  const perPeriod = mapTrends({ data: data.perPeriod });
  return {
    totalDemandMinor: String(data.totalDemandMinor ?? 0),
    totalCollectionMinor: String(data.totalCollectionMinor ?? 0),
    efficiencyBps: typeof data.efficiencyBps === "number" ? data.efficiencyBps : Number(data.efficiencyBps ?? 0),
    perPeriod: perPeriod ?? [],
  };
}

function mapAging(payload: unknown): AgingBuckets | null {
  if (!isRecord(payload)) return null;
  const data = isRecord(payload.data) ? payload.data : payload;
  if (!isRecord(data)) return null;
  const bucket0_30 = data.bucket0_30;
  const bucket31_60 = data.bucket31_60;
  const bucket61_90 = data.bucket61_90;
  const bucket90Plus = data.bucket90Plus;
  if (bucket0_30 === undefined || bucket31_60 === undefined || bucket61_90 === undefined || bucket90Plus === undefined) {
    return null;
  }
  return {
    bucket0_30: String(bucket0_30),
    bucket31_60: String(bucket31_60),
    bucket61_90: String(bucket61_90),
    bucket90Plus: String(bucket90Plus),
  };
}

function mapDefaulters(payload: unknown): DefaulterRow[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: DefaulterRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const assesseeId = raw.assesseeId;
    if (typeof assesseeId !== "string") continue;
    mapped.push({
      rank: typeof raw.rank === "number" ? raw.rank : Number(raw.rank ?? 0),
      assesseeId,
      outstandingMinor: String(raw.outstandingMinor ?? 0),
    });
  }
  return mapped;
}

async function getTrends(granularity: string): Promise<LoaderResult<TrendRow[]>> {
  return fetchJson<unknown, TrendRow[]>(
    `/api/v1/revenue/analytics/trends?granularity=${encodeURIComponent(granularity)}`,
    [],
    { telemetryKey: "revenue.analytics.trends", mapResponse: mapTrends },
  );
}

async function getEfficiency(granularity: string): Promise<LoaderResult<EfficiencyKpi | null>> {
  return fetchJson<unknown, EfficiencyKpi | null>(
    `/api/v1/revenue/analytics/efficiency?granularity=${encodeURIComponent(granularity)}`,
    null,
    { telemetryKey: "revenue.analytics.efficiency", mapResponse: mapEfficiency },
  );
}

async function getAging(): Promise<LoaderResult<AgingBuckets | null>> {
  return fetchJson<unknown, AgingBuckets | null>("/api/v1/revenue/analytics/arrears-aging", null, {
    telemetryKey: "revenue.analytics.arrearsAging",
    mapResponse: mapAging,
  });
}

async function getDefaulters(): Promise<LoaderResult<DefaulterRow[]>> {
  return fetchJson<unknown, DefaulterRow[]>("/api/v1/revenue/analytics/defaulters?limit=20", [], {
    telemetryKey: "revenue.analytics.defaulters",
    mapResponse: mapDefaulters,
  });
}

export default async function RevenueAnalyticsPage({
  searchParams,
}: {
  searchParams?: { granularity?: string };
}) {
  const granularity = searchParams?.granularity === "fy" ? "fy" : "month";

  const [
    { data: trends, source: trendsSource },
    { data: efficiency, source: efficiencySource },
    { data: aging, source: agingSource },
    { data: defaulters, source: defaultersSource },
  ] = await Promise.all([getTrends(granularity), getEfficiency(granularity), getAging(), getDefaulters()]);

  const source =
    trendsSource === "error" || efficiencySource === "error" || agingSource === "error" || defaultersSource === "error"
      ? "error"
      : "api";

  const totalDemand = efficiency?.totalDemandMinor ?? "0";
  const totalCollection = efficiency?.totalCollectionMinor ?? "0";
  const overallEfficiencyBps = efficiency?.efficiencyBps ?? 0;
  const topDefaulterOutstanding = defaulters[0]?.outstandingMinor;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Revenue Analytics"
        subtitle="Arrears aging, top defaulters, collection efficiency, and demand-vs-collection trends and forecast."
        back="/revenue"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="📊" iconBg="#eff6ff" label="Total Demand" value={formatMoney(totalDemand)} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Total Collection" value={formatMoney(totalCollection)} />
        <StatCard icon="⚡" iconBg="#fffbe6" label="Collection Efficiency" value={formatBps(overallEfficiencyBps)} />
        <StatCard
          icon="⚠️"
          iconBg="#fef3f2"
          label="Top Defaulter Outstanding"
          value={topDefaulterOutstanding ? formatMoney(topDefaulterOutstanding) : "—"}
        />
      </StatGrid>

      <nav aria-label="Trend granularity" style={{ display: "flex", gap: 8, marginBottom: 4 }}>
        <Link
          href="/revenue/analytics?granularity=month"
          className={`btn ${granularity === "month" ? "primary" : "ghost"} sm`}
          aria-current={granularity === "month" ? "page" : undefined}
        >
          Monthly
        </Link>
        <Link
          href="/revenue/analytics?granularity=fy"
          className={`btn ${granularity === "fy" ? "primary" : "ghost"} sm`}
          aria-current={granularity === "fy" ? "page" : undefined}
        >
          Financial Year
        </Link>
      </nav>

      <Card title="Analytics">
        <AnalyticsConsole
          granularity={granularity}
          trends={trends}
          trendsSource={trendsSource}
          aging={aging}
          agingSource={agingSource}
          defaulters={defaulters}
          defaultersSource={defaultersSource}
        />
      </Card>
    </main>
  );
}

export type { TrendRow, EfficiencyKpi, AgingBuckets, DefaulterRow };
