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
    const shortId = `${assesseeId.slice(0, 8)}…`;
    const ownerName = typeof raw.ownerName === "string" && raw.ownerName.trim() ? raw.ownerName : shortId;
    const identifierNo = typeof raw.identifierNo === "string" && raw.identifierNo.trim() ? raw.identifierNo : "—";
    mapped.push({
      rank: typeof raw.rank === "number" ? raw.rank : Number(raw.rank ?? 0),
      assesseeId,
      outstandingMinor: String(raw.outstandingMinor ?? 0),
      ownerName,
      identifierNo,
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

type AssesseeLite = { id: string; ownerName: string; identifierNo: string };

// GAP-REVENUE-ANALYTICS-01: the defaulters endpoint returns opaque assessee ids
// only; a collections officer needs the owner + identifier to act. We resolve
// those web-side from the assessees list rather than joining across the
// analytics and assessee module schemas server-side (CLAUDE.md §4 forbids
// cross-module joins). This is best-effort enrichment: if the lookup fails the
// defaulter rows keep their short-id fallback and the error does not mask the
// defaulters tab.
async function getAssesseeMap(): Promise<Map<string, AssesseeLite>> {
  const { data } = await fetchJson<unknown, AssesseeLite[]>("/api/v1/revenue/assessees?limit=200", [], {
    telemetryKey: "revenue.analytics.defaulters.assessees",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: unknown[] })?.data;
      if (!Array.isArray(arr)) return null;
      const out: AssesseeLite[] = [];
      for (const raw of arr) {
        if (typeof raw !== "object" || raw === null) continue;
        const r = raw as Record<string, unknown>;
        if (typeof r.id !== "string") continue;
        out.push({
          id: r.id,
          ownerName: typeof r.ownerName === "string" ? r.ownerName : "",
          identifierNo: typeof r.identifierNo === "string" ? r.identifierNo : "",
        });
      }
      return out;
    },
  });
  return new Map(data.map((a) => [a.id, a]));
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
    { data: defaultersRaw, source: defaultersSource },
    assesseeMap,
  ] = await Promise.all([
    getTrends(granularity),
    getEfficiency(granularity),
    getAging(),
    getDefaulters(),
    getAssesseeMap(),
  ]);

  // Enrich each defaulter with owner/identifier when we could resolve them;
  // otherwise keep the short-id fallback already set by mapDefaulters.
  const defaulters: DefaulterRow[] = defaultersRaw.map((d) => {
    const a = assesseeMap.get(d.assesseeId);
    if (!a) return d;
    return {
      ...d,
      ownerName: a.ownerName.trim() ? a.ownerName : d.ownerName,
      identifierNo: a.identifierNo.trim() ? a.identifierNo : d.identifierNo,
    };
  });

  const source =
    trendsSource === "error" || efficiencySource === "error" || agingSource === "error" || defaultersSource === "error"
      ? "error"
      : "api";

  // Never fall back to a fabricated "0"/0 when the efficiency read failed — that would
  // render as a real ₹0.00 / 0% figure indistinguishable from a genuine zero. Gate each
  // stat on efficiencySource so an error renders "—", not a made-up amount.
  const totalDemand =
    efficiencySource === "error" ? null : (efficiency?.totalDemandMinor ?? "0");
  const totalCollection =
    efficiencySource === "error" ? null : (efficiency?.totalCollectionMinor ?? "0");
  const overallEfficiencyBps = efficiencySource === "error" ? null : (efficiency?.efficiencyBps ?? 0);
  // GAP-REVENUE-ANALYTICS-03: pick the largest outstanding rather than trusting
  // index 0 (the API order is not a guaranteed sort), and tell a failed read
  // apart from a genuinely empty list — the old code showed "—" for both.
  const topDefaulterOutstanding =
    defaultersSource === "error"
      ? null
      : defaulters.reduce<bigint | null>((max, d) => {
          const v = BigInt(d.outstandingMinor);
          return max === null || v > max ? v : max;
        }, null);

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Revenue Analytics"
        subtitle="Arrears aging, top defaulters, collection efficiency, and demand-vs-collection trends and forecast."
        back="/revenue"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="📊" iconBg="#eff6ff" label="Total Demand" value={totalDemand === null ? "—" : formatMoney(totalDemand)} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Total Collection" value={totalCollection === null ? "—" : formatMoney(totalCollection)} />
        <StatCard
          icon="⚡"
          iconBg="#fffbe6"
          label="Collection Efficiency"
          value={overallEfficiencyBps === null ? "—" : formatBps(overallEfficiencyBps)}
        />
        <StatCard
          icon="⚠️"
          iconBg="#fef3f2"
          label="Top Defaulter Outstanding"
          value={
            defaultersSource === "error"
              ? "—"
              : formatMoney(String(topDefaulterOutstanding ?? 0n))
          }
        />
      </StatGrid>
      {efficiencySource === "error" && <DataSourceBadge source="error" />}

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
    </div>
  );
}

export type { TrendRow, EfficiencyKpi, AgingBuckets, DefaulterRow };
