/**
 * Section 8 reporting/analytics gap-close routes.
 *
 * GET /v1/crm/dashboard/pipeline-coverage      — weighted pipeline / quota ratio (#5)
 * GET /v1/crm/dashboard/forecast-breakdown     — deal values grouped by dimensions (#6)
 * GET /v1/crm/dashboard/activity-metrics       — calls/meetings/emails/tasks per owner/period (#8)
 * PATCH /v1/crm/campaigns/:id/cost             — record campaign spend (admin only) (#10)
 * GET /v1/crm/dashboard/campaign-roi-full      — full ROI with cost (#10)
 * GET /v1/crm/dashboard/inactive-users         — users with no activity in N days (#11)
 * GET /v1/crm/dashboard/integration-health     — summary of integration failures (#11)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { listQuery, windowOf } from "../../shared/list-query.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin", "sales_officer"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const periodEnum = z.enum(["day", "week", "month"]).default("month");

// ═══════════════════════════════════════════════════════════════════════════════
// #5: Pipeline Coverage Ratio
// ═══════════════════════════════════════════════════════════════════════════════
const pipelineCoverageQuery = z.object({
  period: periodEnum,
  teamId: z.string().uuid().optional(),
  quota: z.coerce.number().int().min(1).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// #6: Forecast Breakdown
// ═══════════════════════════════════════════════════════════════════════════════
const forecastBreakdownQuery = z.object({
  groupBy: z.string().max(200).default("product"),
  period: periodEnum,
});

// ═══════════════════════════════════════════════════════════════════════════════
// #8: Activity Metrics
// ═══════════════════════════════════════════════════════════════════════════════
const activityMetricsQuery = z.object({
  period: periodEnum,
  ownerId: z.string().uuid().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// #10: Campaign Cost
// ═══════════════════════════════════════════════════════════════════════════════
const campaignCostBody = z.object({
  costMinor: z.string().regex(/^\d{1,25}$/, "must be a non-negative integer string of minor units"),
  currency: z.string().length(3).default("INR"),
});

const campaignRoiFullQuery = listQuery;

// ═══════════════════════════════════════════════════════════════════════════════
// #11: Inactive Users
// ═══════════════════════════════════════════════════════════════════════════════
const inactiveUsersQuery = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(30),
});

function periodTrunc(period: string): string {
  switch (period) {
    case "day": return "day";
    case "week": return "week";
    case "month": return "month";
    default: return "month";
  }
}

export async function section8Routes(app: FastifyInstance): Promise<void> {

  // ═══════════════════════════════════════════════════════════════════════════
  // #5: Pipeline Coverage Ratio
  // weighted pipeline value / quota, grouped by team/period
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/v1/crm/dashboard/pipeline-coverage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = pipelineCoverageQuery.parse(req.query);
    const trunc = periodTrunc(q.period);

    const data = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT
          date_trunc(${trunc}, d.created_at)::text AS period,
          COALESCE(t.id::text, 'unassigned') AS team,
          COALESCE(t.name, 'Unassigned') AS "teamName",
          sum((d.value_minor * d.probability / 100))::text AS "weightedPipeline",
          count(*)::int AS "dealCount"
        FROM crm.deals d
        LEFT JOIN crm.contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
        LEFT JOIN crm.teams t ON t.id = c.owner_id AND t.tenant_id = d.tenant_id
        WHERE d.tenant_id = ${ctx.tenantId}
          AND d.status = 'active'
          ${q.teamId ? sql`AND t.id = ${q.teamId}` : sql``}
        GROUP BY 1, t.id, t.name
        ORDER BY 1 DESC
      `) as unknown as Array<{
        period: string;
        team: string;
        teamName: string;
        weightedPipeline: string;
        dealCount: number;
      }>;
    });

    // Apply quota if provided, otherwise use a default multiplier view
    const quotaValue = q.quota ? BigInt(q.quota) : null;

    const result = data.map((row) => {
      const weighted = BigInt(row.weightedPipeline);
      const coverageRatio = quotaValue && quotaValue > 0n
        ? Number((weighted * 100n) / quotaValue) / 100
        : null;
      return {
        period: row.period,
        team: row.team,
        teamName: row.teamName,
        weightedPipeline: row.weightedPipeline,
        quota: quotaValue?.toString() ?? null,
        coverageRatio,
        dealCount: row.dealCount,
      };
    });

    return reply.send({ data: result, meta: { period: q.period } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // #6: Forecast Breakdown by region/product/confidence/team/period
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/v1/crm/dashboard/forecast-breakdown", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = forecastBreakdownQuery.parse(req.query);
    const trunc = periodTrunc(q.period);

    // Parse multi-select groupBy (comma-separated)
    const validDimensions = new Set(["region", "product", "confidence", "team", "period"]);
    const dimensions = q.groupBy
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter((d) => validDimensions.has(d));

    if (dimensions.length === 0) {
      throw new HttpError(400, "INVALID_GROUP_BY", "groupBy must include at least one of: region, product, confidence, team, period");
    }

    // Build dynamic GROUP BY columns
    const selectParts: string[] = [];
    const groupParts: string[] = [];

    for (const dim of dimensions) {
      switch (dim) {
        case "region":
          selectParts.push(`COALESCE(c.region, 'unknown') AS region`);
          groupParts.push(`c.region`);
          break;
        case "product":
          selectParts.push(`COALESCE(d.product, 'unknown') AS product`);
          groupParts.push(`d.product`);
          break;
        case "confidence":
          selectParts.push(`d.probability AS confidence`);
          groupParts.push(`d.probability`);
          break;
        case "team":
          selectParts.push(`COALESCE(d.owner_id::text, 'unassigned') AS team`);
          groupParts.push(`d.owner_id`);
          break;
        case "period":
          selectParts.push(`date_trunc('${trunc}', d.created_at)::text AS period`);
          groupParts.push(`date_trunc('${trunc}', d.created_at)`);
          break;
      }
    }

    const selectClause = selectParts.join(", ");
    const groupClause = groupParts.join(", ");

    const data = await scopedRead(async (tx) => {
      return tx.execute(sql.raw(`
        SELECT
          ${selectClause},
          sum(d.value_minor)::text AS "totalValue",
          sum(d.value_minor * d.probability / 100)::text AS "weightedValue",
          count(*)::int AS "dealCount"
        FROM crm.deals d
        LEFT JOIN crm.contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
        WHERE d.tenant_id = '${ctx.tenantId}'
          AND d.status = 'active'
        GROUP BY ${groupClause}
        ORDER BY sum(d.value_minor * d.probability / 100) DESC
      `)) as unknown as Array<Record<string, unknown>>;
    });

    return reply.send({ data, meta: { groupBy: dimensions, period: q.period } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // #8: Activity/Productivity Metrics
  // calls, meetings, emails, tasks, follow-ups, overdue counts per owner/period
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/v1/crm/dashboard/activity-metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = activityMetricsQuery.parse(req.query);
    const trunc = periodTrunc(q.period);

    const data = await scopedRead(async (tx) => {
      // Activity counts by type and owner
      const activities = await tx.execute(sql`
        SELECT
          date_trunc(${trunc}, a.created_at)::text AS period,
          a.created_by AS "ownerId",
          count(*) FILTER (WHERE a.type = 'call')::int AS calls,
          count(*) FILTER (WHERE a.type = 'meeting')::int AS meetings,
          count(*) FILTER (WHERE a.type = 'email')::int AS emails,
          count(*) FILTER (WHERE a.type = 'task')::int AS tasks,
          count(*) FILTER (WHERE a.type NOT IN ('call', 'meeting', 'email', 'task'))::int AS other,
          count(*)::int AS total
        FROM crm.activities a
        WHERE a.tenant_id = ${ctx.tenantId}
          ${q.ownerId ? sql`AND a.created_by = ${q.ownerId}` : sql``}
        GROUP BY 1, 2
        ORDER BY 1 DESC, total DESC
      `) as unknown as Array<{
        period: string;
        ownerId: string;
        calls: number;
        meetings: number;
        emails: number;
        tasks: number;
        other: number;
        total: number;
      }>;

      // Follow-up / overdue counts from next_actions
      const followUps = await tx.execute(sql`
        SELECT
          date_trunc(${trunc}, na.due_at)::text AS period,
          na.created_by AS "ownerId",
          count(*)::int AS "followUps",
          count(*) FILTER (WHERE na.completed_at IS NULL AND na.due_at < now())::int AS overdue,
          count(*) FILTER (WHERE na.completed_at IS NOT NULL)::int AS completed
        FROM crm.next_actions na
        WHERE na.tenant_id = ${ctx.tenantId}
          ${q.ownerId ? sql`AND na.created_by = ${q.ownerId}` : sql``}
        GROUP BY 1, 2
      `) as unknown as Array<{
        period: string;
        ownerId: string;
        followUps: number;
        overdue: number;
        completed: number;
      }>;

      // Communications count
      const comms = await tx.execute(sql`
        SELECT
          date_trunc(${trunc}, cm.created_at)::text AS period,
          cm.logged_by AS "ownerId",
          count(*)::int AS communications
        FROM crm.communications cm
        WHERE cm.tenant_id = ${ctx.tenantId}
          ${q.ownerId ? sql`AND cm.logged_by = ${q.ownerId}` : sql``}
        GROUP BY 1, 2
      `).catch(() => [] as Array<{ period: string; ownerId: string; communications: number }>) as unknown as Array<{
        period: string;
        ownerId: string;
        communications: number;
      }>;

      // Merge all metrics by (period, ownerId)
      const key = (period: string, ownerId: string) => `${period}|${ownerId}`;
      const merged = new Map<string, {
        period: string;
        ownerId: string;
        calls: number;
        meetings: number;
        emails: number;
        tasks: number;
        other: number;
        total: number;
        followUps: number;
        overdue: number;
        completed: number;
        communications: number;
      }>();

      for (const row of activities) {
        const k = key(row.period, row.ownerId);
        merged.set(k, {
          ...row,
          followUps: 0,
          overdue: 0,
          completed: 0,
          communications: 0,
        });
      }

      for (const row of followUps) {
        const k = key(row.period, row.ownerId);
        const existing = merged.get(k);
        if (existing) {
          existing.followUps = row.followUps;
          existing.overdue = row.overdue;
          existing.completed = row.completed;
        } else {
          merged.set(k, {
            period: row.period,
            ownerId: row.ownerId,
            calls: 0,
            meetings: 0,
            emails: 0,
            tasks: 0,
            other: 0,
            total: 0,
            followUps: row.followUps,
            overdue: row.overdue,
            completed: row.completed,
            communications: 0,
          });
        }
      }

      for (const row of comms) {
        const k = key(row.period, row.ownerId);
        const existing = merged.get(k);
        if (existing) {
          existing.communications = row.communications;
        } else {
          merged.set(k, {
            period: row.period,
            ownerId: row.ownerId,
            calls: 0,
            meetings: 0,
            emails: 0,
            tasks: 0,
            other: 0,
            total: 0,
            followUps: 0,
            overdue: 0,
            completed: 0,
            communications: row.communications,
          });
        }
      }

      return Array.from(merged.values()).sort((a, b) => b.period.localeCompare(a.period));
    });

    return reply.send({ data, meta: { period: q.period } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // #10: Campaign Cost Input (admin-only)
  // ═══════════════════════════════════════════════════════════════════════════
  app.patch("/v1/crm/campaigns/:id/cost", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = campaignCostBody.parse(req.body);

    await scopedRead(async (tx) => {
      // Update cost on all campaign_performance rows for this campaign,
      // or insert a summary row if none exists yet.
      const updated = await tx.execute(sql`
        UPDATE crm.campaign_performance
        SET cost_minor = ${body.costMinor}::bigint,
            currency = ${body.currency.toUpperCase()}
        WHERE tenant_id = ${ctx.tenantId}
          AND campaign_id = ${id}
      `) as unknown as Array<unknown>;

      if (!updated || (updated as unknown[]).length === 0) {
        // No existing rows — insert a cost-only row
        await tx.execute(sql`
          INSERT INTO crm.campaign_performance (
            id, tenant_id, campaign_id, cost_minor, revenue_minor, responses, currency, period_start, created_by, updated_by
          ) VALUES (
            gen_random_uuid(), ${ctx.tenantId}, ${id}, ${body.costMinor}::bigint, 0, 0,
            ${body.currency.toUpperCase()}, '1970-01-01', ${ctx.actorId}, ${ctx.actorId}
          )
        `);
      }
    });

    return reply.status(200).send({ data: { campaignId: id, costMinor: body.costMinor, currency: body.currency.toUpperCase() } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // #10: Full Campaign ROI (with cost)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/v1/crm/dashboard/campaign-roi-full", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = campaignRoiFullQuery.parse(req.query ?? {});
    const w = windowOf(q);

    const { rows, total } = await scopedRead(async (tx) => {
      const data = await tx.execute(sql`
        SELECT
          campaign_id AS "campaignId",
          sum(responses)::int AS responses,
          sum(cost_minor)::text AS "costMinor",
          sum(revenue_minor)::text AS "revenueMinor",
          min(currency) AS currency,
          count(*)::int AS periods
        FROM crm.campaign_performance
        WHERE tenant_id = ${ctx.tenantId}
        GROUP BY campaign_id
        ORDER BY sum(revenue_minor) DESC
        LIMIT ${w.pageSize} OFFSET ${w.offset}
      `) as unknown as Array<{
        campaignId: string;
        responses: number;
        costMinor: string;
        revenueMinor: string;
        currency: string;
        periods: number;
      }>;
      const counted = await tx.execute(sql`
        SELECT count(DISTINCT campaign_id)::int AS total
        FROM crm.campaign_performance
        WHERE tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{ total: number }>;
      return { rows: data, total: counted[0]?.total ?? 0 };
    });

    const data = rows.map((r) => {
      const cost = BigInt(r.costMinor);
      const revenue = BigInt(r.revenueMinor);
      const net = revenue - cost;
      const roiPercent = cost > 0n
        ? Number((net * 10000n) / cost) / 100
        : null;
      return {
        campaignId: r.campaignId,
        currency: r.currency,
        costMinor: r.costMinor,
        revenueMinor: r.revenueMinor,
        netMinor: net.toString(),
        roiPercent,
        responses: r.responses,
        periods: r.periods,
      };
    });

    return reply.send({ data, meta: { page: w.page, pageSize: w.pageSize, total } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // #11: Inactive Users (users with no activity in N days)
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/v1/crm/dashboard/inactive-users", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = inactiveUsersQuery.parse(req.query);

    const data = await scopedRead(async (tx) => {
      // Compute from activities: users who last created an activity more than N days ago
      return tx.execute(sql`
        SELECT
          a.created_by AS "userId",
          max(a.created_at)::text AS "lastActivityAt",
          EXTRACT(EPOCH FROM (now() - max(a.created_at)) / 86400)::int AS "inactiveDays",
          count(*)::int AS "totalActivities"
        FROM crm.activities a
        WHERE a.tenant_id = ${ctx.tenantId}
        GROUP BY a.created_by
        HAVING max(a.created_at) < now() - make_interval(days => ${q.days})
        ORDER BY max(a.created_at) ASC
      `) as unknown as Array<{
        userId: string;
        lastActivityAt: string;
        inactiveDays: number;
        totalActivities: number;
      }>;
    });

    return reply.send({ data, meta: { days: q.days, count: data.length } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // #11: Integration Health
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/v1/crm/dashboard/integration-health", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);

    const data = await scopedRead(async (tx) => {
      // Count stuck outbox messages (created but not published for >5 min)
      const outboxStuck = await tx.execute(sql`
        SELECT
          COALESCE(topic, 'unknown') AS integration,
          count(*)::int AS "stuckMessages",
          max(created_at)::text AS "oldestStuckAt"
        FROM _outbox.messages
        WHERE tenant_id = ${ctx.tenantId}
          AND published_at IS NULL
          AND created_at < now() - interval '5 minutes'
        GROUP BY topic
        ORDER BY count(*) DESC
      `).catch(() => []) as unknown as Array<{
        integration: string;
        stuckMessages: number;
        oldestStuckAt: string | null;
      }>;

      // Overall outbox health metrics
      const outboxStats = await tx.execute(sql`
        SELECT
          count(*)::int AS "totalMessages",
          count(*) FILTER (WHERE published_at IS NOT NULL)::int AS published,
          count(*) FILTER (WHERE published_at IS NULL)::int AS pending
        FROM _outbox.messages
        WHERE tenant_id = ${ctx.tenantId}
          AND created_at > now() - interval '24 hours'
      `).catch(() => [{ totalMessages: 0, published: 0, pending: 0 }]) as unknown as Array<{
        totalMessages: number;
        published: number;
        pending: number;
      }>;

      const stats = outboxStats[0] ?? { totalMessages: 0, published: 0, pending: 0 };
      const hasFailures = outboxStuck.length > 0 || stats.pending > 10;

      return {
        outboxFailures: outboxStuck,
        outboxStats: stats,
        inboxHealth: { processedLast24h: stats.published },
        status: hasFailures ? "degraded" : "healthy",
      };
    });

    return reply.send({ data });
  });
}
