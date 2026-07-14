/**
 * visitor-service: analytics routes.
 *
 * Three GET endpoints for visitor analytics (Requirements 19.1, 19.2, 19.4):
 * - /daily: returns pre-computed daily metrics for a given date
 * - /trends: returns weekly/monthly trend buckets over a date range
 * - /export: returns CSV download of daily metrics for a configurable date range
 *
 * All reads go through Postgres (RLS-scoped by tenant_id). Analytics data
 * is not PII, so no pii_access_log entries are needed. Role-gated to staff
 * roles that need visibility into visitor traffic patterns.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, gte, lte } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { dailyMetrics } from "./schema.js";
import { computeTrends, type DailyMetric } from "./domain.js";
import { dailyQuery, trendsQuery, exportQuery } from "./validators.js";

const READ_ROLES = ["security_admin", "protocol_officer", "tenant_admin", "super_admin"];

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/visitor/analytics/daily
   * Returns daily metrics for a specific date (query param).
   * Reads from daily_metrics table.
   * Requirement 19.1
   */
  app.get("/v1/visitor/analytics/daily", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = dailyQuery.parse(req.query);

    const dateStart = new Date(query.date);
    // Normalize to start of day (UTC)
    dateStart.setUTCHours(0, 0, 0, 0);
    const dateEnd = new Date(dateStart);
    dateEnd.setUTCDate(dateEnd.getUTCDate() + 1);

    const conditions = [
      eq(dailyMetrics.tenantId, ctx.tenantId),
      gte(dailyMetrics.date, dateStart),
      lte(dailyMetrics.date, dateStart), // exact day match
    ];
    if (query.locationId) {
      conditions.push(eq(dailyMetrics.locationId, query.locationId));
    }

    const rows = await scopedRead((tx) => tx.select().from(dailyMetrics).where(and(...conditions)));
    return reply.send({ data: rows });
  });

  /**
   * GET /v1/visitor/analytics/trends
   * Returns weekly/monthly trend data computed from stored daily metrics.
   * Uses domain.ts computeTrends for aggregation.
   * Requirement 19.2
   */
  app.get("/v1/visitor/analytics/trends", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = trendsQuery.parse(req.query);

    const dateFrom = new Date(query.dateFrom);
    const dateTo = new Date(query.dateTo);

    const conditions = [
      eq(dailyMetrics.tenantId, ctx.tenantId),
      gte(dailyMetrics.date, dateFrom),
      lte(dailyMetrics.date, dateTo),
    ];
    if (query.locationId) {
      conditions.push(eq(dailyMetrics.locationId, query.locationId));
    }

    const rows = await scopedRead((tx) => tx.select().from(dailyMetrics).where(and(...conditions)));

    // Map DB rows to the DailyMetric shape expected by computeTrends
    const metrics: DailyMetric[] = rows.map((r) => ({
      date: r.date,
      totalVisits: r.totalVisits,
      uniqueVisitors: r.uniqueVisitors,
      avgApprovalTimeMs: r.avgApprovalTimeMs,
      avgVisitDurationMs: r.avgVisitDurationMs,
      peakHour: r.peakHour,
      noShowCount: r.noShowCount,
    }));

    const trends = computeTrends(metrics, query.period);
    return reply.send({ data: trends });
  });

  /**
   * GET /v1/visitor/analytics/export
   * Returns CSV download with Content-Type text/csv.
   * Configurable date range via query params.
   * Requirement 19.4
   */
  app.get("/v1/visitor/analytics/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = exportQuery.parse(req.query);

    const dateFrom = new Date(query.dateFrom);
    const dateTo = new Date(query.dateTo);

    const conditions = [
      eq(dailyMetrics.tenantId, ctx.tenantId),
      gte(dailyMetrics.date, dateFrom),
      lte(dailyMetrics.date, dateTo),
    ];
    if (query.locationId) {
      conditions.push(eq(dailyMetrics.locationId, query.locationId));
    }

    const rows = await scopedRead((tx) => tx.select().from(dailyMetrics).where(and(...conditions)));

    // Build CSV content
    const header = "date,location_id,total_visits,unique_visitors,avg_approval_time_ms,avg_visit_duration_ms,peak_hour,no_show_count,rejected_count";
    const csvRows = rows.map((r) => [
      r.date.toISOString(),
      r.locationId,
      r.totalVisits,
      r.uniqueVisitors,
      r.avgApprovalTimeMs ?? "",
      r.avgVisitDurationMs ?? "",
      r.peakHour ?? "",
      r.noShowCount,
      r.rejectedCount,
    ].join(","));

    const csv = [header, ...csvRows].join("\n");

    return reply
      .header("Content-Type", "text/csv")
      .header("Content-Disposition", `attachment; filename="visitor-analytics-${query.dateFrom.split("T")[0]}-to-${query.dateTo.split("T")[0]}.csv"`)
      .send(csv);
  });
}
