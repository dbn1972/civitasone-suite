/**
 * Analytics module — read models over the DCB (demand/collection/balance) ledger.
 *
 * Reads are tenant-scoped: every query carries an explicit `tenant_id = $1`
 * predicate AND runs inside the per-request tenant transaction whose
 * `app.tenant_id` GUC is enforced by RLS as a defense-in-depth backstop.
 *
 * All transformation is delegated to pure, exported helpers so the analytics
 * math is unit-testable without a live database.
 *
 * _Requirements: SVC-140_
 */
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { dcbEntries, demands } from "../assessment/schema.js";
import { eq } from "drizzle-orm";
import { SERVICE } from "../../topics.js";
import {
  aggregatePeriodSeries,
  collectionEfficiencyBps,
  rankDefaulters,
  type PeriodDcbEntry,
  type PeriodTrend,
  type RankedDefaulter,
} from "./domain.js";
import { ageIntoBuckets } from "../assessment/domain.js";

export type Granularity = "month" | "fy";

/**
 * Derive a period bucket key from an ISO timestamp.
 * - "month" → "YYYY-MM"
 * - "fy"    → Indian financial year "YYYY-YYYY" (Apr–Mar)
 */
export function periodKey(iso: string | Date, granularity: Granularity): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 1..12
  if (granularity === "fy") {
    return m >= 4 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

interface RawDcbRow {
  createdAt: string | Date;
  entryType: string;
  amountMinor: bigint;
}

/** Map raw DCB ledger rows into period-keyed entries for aggregation. */
export function toPeriodEntries(rows: RawDcbRow[], granularity: Granularity): PeriodDcbEntry[] {
  return rows.map((r) => ({
    period: periodKey(r.createdAt, granularity),
    entryType: r.entryType as PeriodDcbEntry["entryType"],
    amountMinor: r.amountMinor,
  }));
}

/** Current outstanding balance per demand from its DCB ledger movements. */
export function computeDemandBalances(
  rows: Array<{ demandId: string; entryType: string; amountMinor: bigint }>,
): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  for (const r of rows) {
    const cur = balances.get(r.demandId) ?? 0n;
    balances.set(r.demandId, r.entryType === "demand" ? cur + r.amountMinor : cur - r.amountMinor);
  }
  return balances;
}

/** Roll per-demand outstanding balances up to per-assessee totals. */
export function outstandingByAssessee(
  demandRows: Array<{ id: string; assesseeId: string }>,
  balances: Map<string, bigint>,
): Array<{ assesseeId: string; outstandingMinor: bigint }> {
  const byAssessee = new Map<string, bigint>();
  for (const d of demandRows) {
    const bal = balances.get(d.id) ?? 0n;
    byAssessee.set(d.assesseeId, (byAssessee.get(d.assesseeId) ?? 0n) + bal);
  }
  return [...byAssessee.entries()].map(([assesseeId, outstandingMinor]) => ({ assesseeId, outstandingMinor }));
}

// ── DB reads ────────────────────────────────────────────────────────────────────

async function loadDcbRows(tenantId: string): Promise<RawDcbRow[]> {
  const rows = await db
    .select({
      createdAt: dcbEntries.createdAt,
      entryType: dcbEntries.entryType,
      amountMinor: dcbEntries.amountMinor,
    })
    .from(dcbEntries)
    .where(eq(dcbEntries.tenantId, tenantId));
  return rows as RawDcbRow[];
}

/** Per-period demand-vs-collection trend series (ascending by period). */
export async function getTrends(tenantId: string, granularity: Granularity): Promise<PeriodTrend[]> {
  const cached = await cache.getOrLoad(`${SERVICE}:${tenantId}:analytics:trends:${granularity}`, async () => {
    const rows = await loadDcbRows(tenantId);
    return aggregatePeriodSeries(toPeriodEntries(rows, granularity)).map((t) => ({
      period: t.period,
      demandMinor: t.demandMinor.toString(),
      collectionMinor: t.collectionMinor.toString(),
      efficiencyBps: t.efficiencyBps,
    }));
  });
  return (cached ?? []).map((t) => ({
    period: t.period,
    demandMinor: BigInt(t.demandMinor),
    collectionMinor: BigInt(t.collectionMinor),
    efficiencyBps: t.efficiencyBps,
  }));
}

/** Ascending per-period collection series (paise) — the forecast input. */
export async function getCollectionSeries(tenantId: string, granularity: Granularity): Promise<bigint[]> {
  const trends = await getTrends(tenantId, granularity);
  return trends.map((t) => t.collectionMinor);
}

export interface EfficiencyKpi {
  totalDemandMinor: bigint;
  totalCollectionMinor: bigint;
  efficiencyBps: number;
  perPeriod: PeriodTrend[];
}

/** Overall + per-period collection-efficiency KPIs. */
export async function getEfficiency(tenantId: string, granularity: Granularity): Promise<EfficiencyKpi> {
  const perPeriod = await getTrends(tenantId, granularity);
  let totalDemand = 0n;
  let totalCollection = 0n;
  for (const p of perPeriod) {
    totalDemand += p.demandMinor;
    totalCollection += p.collectionMinor;
  }
  return {
    totalDemandMinor: totalDemand,
    totalCollectionMinor: totalCollection,
    efficiencyBps: collectionEfficiencyBps(totalDemand, totalCollection),
    perPeriod,
  };
}

/** Arrears aging buckets (0-30 / 31-60 / 61-90 / 90+) as of a date. */
export async function getArrearsAging(tenantId: string, asOfDate: string) {
  const cached = await cache.getOrLoad(`${SERVICE}:${tenantId}:analytics:aging:${asOfDate}`, async () => {
    const demandRows = await db
      .select({ id: demands.id, dueDate: demands.dueDate })
      .from(demands)
      .where(eq(demands.tenantId, tenantId));
    const dcbRows = await db
      .select({ demandId: dcbEntries.demandId, entryType: dcbEntries.entryType, amountMinor: dcbEntries.amountMinor })
      .from(dcbEntries)
      .where(eq(dcbEntries.tenantId, tenantId));

    const balances = computeDemandBalances(dcbRows as Array<{ demandId: string; entryType: string; amountMinor: bigint }>);
    const aged = ageIntoBuckets(
      (demandRows as Array<{ id: string; dueDate: string }>).map((d) => ({
        dueDate: d.dueDate,
        balanceMinor: balances.get(d.id) ?? 0n,
      })),
      asOfDate,
    );
    return {
      bucket0_30: aged.bucket0_30.toString(),
      bucket31_60: aged.bucket31_60.toString(),
      bucket61_90: aged.bucket61_90.toString(),
      bucket90Plus: aged.bucket90Plus.toString(),
    };
  });
  return cached!;
}

/** Top-N defaulters by outstanding balance. */
export async function getDefaulters(tenantId: string, limit: number): Promise<RankedDefaulter[]> {
  const cached = await cache.getOrLoad(`${SERVICE}:${tenantId}:analytics:defaulters:${limit}`, async () => {
    const demandRows = await db
      .select({ id: demands.id, assesseeId: demands.assesseeId })
      .from(demands)
      .where(eq(demands.tenantId, tenantId));
    const dcbRows = await db
      .select({ demandId: dcbEntries.demandId, entryType: dcbEntries.entryType, amountMinor: dcbEntries.amountMinor })
      .from(dcbEntries)
      .where(eq(dcbEntries.tenantId, tenantId));

    const balances = computeDemandBalances(dcbRows as Array<{ demandId: string; entryType: string; amountMinor: bigint }>);
    const outstanding = outstandingByAssessee(
      demandRows as Array<{ id: string; assesseeId: string }>,
      balances,
    );
    return rankDefaulters(outstanding, limit).map((r) => ({
      assesseeId: r.assesseeId,
      outstandingMinor: r.outstandingMinor.toString(),
      rank: r.rank,
    }));
  });
  return (cached ?? []).map((r) => ({
    assesseeId: r.assesseeId,
    outstandingMinor: BigInt(r.outstandingMinor),
    rank: r.rank,
  }));
}
