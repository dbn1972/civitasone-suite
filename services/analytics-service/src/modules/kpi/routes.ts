/**
 * KPI, Data Warehouse, and AI Insights read-only routes.
 * Previously these were mock pages with hardcoded arrays.
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { savedMetrics } from "../metrics/schema.js";
import { factEvents } from "../facts/schema.js";
import { eq, count, max, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
// GAP2-ANALYTICS-ROLES-01: single canonical reader vocabulary across every
// analytics read route (union of the two historical names so no existing
// principal loses access). Previously this file used a bare
// ["analytics_viewer", ...] array that did NOT include "analytics_user".
import { buildKpis, KPI_DEFS, type FactAgg, type KpiOverride } from "./producer.js";
import { ANALYTICS_READ_ROLES as READ_ROLES } from "../../shared/roles.js";

function paginationMeta(total: number, page: number, pageSize: number) {
  return { page, pageSize, total };
}

/**
 * The data-warehouse "lastRefresh" is really the LATEST EVENT time (max
 * occurred_at), not a refresh time. A future-dated seed/event must never show
 * as a refresh in the future, so it is clamped to `now`. Exported for tests.
 */
export function formatLatestEventTime(last: Date | null, now: Date = new Date()): string {
  if (!last || Number.isNaN(last.getTime())) return "—";
  const shown = last.getTime() > now.getTime() ? now : last;
  return shown.toISOString().slice(0, 16).replace("T", " ");
}


const DAY_MS = 86_400_000;

/**
 * Tenant-wide KPI inputs: fact_events aggregated over the current 30d and prior
 * 30d windows (future-dated events excluded), plus tenant-configured targets /
 * owners from saved_metrics (spec.target / spec.owner, keyed by metric_key ==
 * KPI key). Reads analytics' OWN tables only.
 */
export async function loadKpiInputs(
  tenantId: string,
  now: Date = new Date(),
): Promise<{ aggs: FactAgg[]; overrides: Record<string, KpiOverride> }> {
  const curFrom = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const prevFrom = new Date(now.getTime() - 60 * DAY_MS).toISOString();
  const nowIso = now.toISOString();
  const inCur = sql`${factEvents.occurredAt} >= ${curFrom}::timestamptz and ${factEvents.occurredAt} <= ${nowIso}::timestamptz`;
  const inPrev = sql`${factEvents.occurredAt} >= ${prevFrom}::timestamptz and ${factEvents.occurredAt} < ${curFrom}::timestamptz`;
  return runWithTenant(tenantId, () => scopedRead(async (tx) => {
    const raw = await tx.select({
      source: factEvents.source,
      eventType: factEvents.eventType,
      status: factEvents.status,
      curCount: sql<number>`count(*) filter (where ${inCur})`.mapWith(Number),
      curSum: sql<number>`coalesce(sum(${factEvents.amount}) filter (where ${inCur}), 0)`.mapWith(Number),
      prevCount: sql<number>`count(*) filter (where ${inPrev})`.mapWith(Number),
      prevSum: sql<number>`coalesce(sum(${factEvents.amount}) filter (where ${inPrev}), 0)`.mapWith(Number),
    }).from(factEvents)
      .where(sql`${factEvents.tenantId} = ${tenantId} and ${factEvents.occurredAt} >= ${prevFrom}::timestamptz and ${factEvents.occurredAt} <= ${nowIso}::timestamptz`)
      .groupBy(factEvents.source, factEvents.eventType, factEvents.status);
    const metrics = await tx.select({ metricKey: savedMetrics.metricKey, spec: savedMetrics.spec })
      .from(savedMetrics).where(eq(savedMetrics.tenantId, tenantId)).limit(200);
    const known = new Set(KPI_DEFS.map((d) => d.key));
    const overrides: Record<string, KpiOverride> = {};
    for (const m of metrics) {
      if (!known.has(m.metricKey)) continue;
      const spec = (m.spec ?? {}) as Record<string, unknown>;
      const o: KpiOverride = {};
      if (typeof spec.target === "number" && Number.isFinite(spec.target)) o.target = spec.target;
      if (typeof spec.owner === "string") o.owner = spec.owner.slice(0, 100);
      overrides[m.metricKey] = o;
    }
    return { aggs: raw as FactAgg[], overrides };
  }));
}

export async function kpiRoutes(app: FastifyInstance): Promise<void> {
  // ─── KPI Library ────────────────────────────────────────────────────────────
  app.get("/v1/analytics/kpis", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const tenantId = ctx.tenantId;

    // Cache the tenant-wide aggregates + configured targets; the per-viewer
    // module-role filter (D10) is applied AFTER the cache so one viewer's
    // visibility never leaks to another through the shared key.
    const base = await cache.getOrLoad(cache.makeKey(tenantId, "analytics", "kpis"), () =>
      loadKpiInputs(tenantId),
    );
    const data = buildKpis(base?.aggs ?? [], ctx.roles ?? [], base?.overrides ?? {});

    return reply.send({ data, meta: paginationMeta(data.length, 1, 200) });
  });

  // ─── Data Warehouse (dataset summary) ──────────────────────────────────────
  app.get("/v1/analytics/data-warehouse", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const tenantId = ctx.tenantId;

    const rows = await cache.getOrLoad(
      cache.makeKey(tenantId, "analytics", "data-warehouse"),
      async () => {
        // Summarize fact_events by source module. GAP2-ANALYTICS-DATA-WAREHOUSE-01:
        // `lastRefresh` is derived from the real max(occurred_at) of each
        // source's fact_events — NOT request time. The old
        // `new Date().toISOString()` stamped "now" on every request, falsely
        // implying a just-completed refresh. `size`/`qualityScore` remain "—"
        // (no real signal exists), and `status` is now "—" (unknown) rather
        // than a blanket "Healthy" that made the page's Attention count
        // structurally always 0.
        const result = await runWithTenant(tenantId, () => scopedRead(async (tx) =>
          tx.select({
            source: factEvents.source,
            recordCount: count(factEvents.id),
            lastOccurredAt: max(factEvents.occurredAt),
          }).from(factEvents)
            .where(eq(factEvents.tenantId, tenantId))
            .groupBy(factEvents.source)
            .orderBy(factEvents.source)
            .limit(50),
        ));
        return result.map((r) => {
          const last = r.lastOccurredAt
            ? new Date(r.lastOccurredAt as unknown as string | Date)
            : null;
          return {
            dataset: r.source ?? "Unknown",
            lastRefresh: formatLatestEventTime(last),
            records: String(r.recordCount),
            size: "—",
            qualityScore: "—",
            status: "—",
          };
        });
      },
    );

    return reply.send({ data: rows ?? [], meta: paginationMeta((rows ?? []).length, 1, 50) });
  });

  // ─── AI Insights ───────────────────────────────────────────────────────────
  app.get("/v1/analytics/ai-insights", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const tenantId = ctx.tenantId;

    // AI insights are generated asynchronously; this endpoint returns persisted results.
    // When no insights exist, the page will show EmptyState.
    const rows = await cache.getOrLoad(
      cache.makeKey(tenantId, "analytics", "ai-insights"),
      async () => {
        // Return empty for now — AI insights are generated by a separate scheduled process
        // gated behind FEATURE_AI_ASSISTANT_ENABLED
        return [] as Array<{
          insightTitle: string;
          module: string;
          confidence: string;
          generatedDate: string;
          actionRecommended: string;
          status: string;
        }>;
      },
    );

    return reply.send({ data: rows ?? [], meta: paginationMeta((rows ?? []).length, 1, 200) });
  });
}
