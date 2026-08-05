/**
 * Dashboard analytics routes — Gaps 3, 4, 7, 9.
 *
 * GET /v1/crm/dashboard/lead-response-time    — avg time from lead creation to first activity
 * GET /v1/crm/dashboard/lead-ageing           — lead counts by ageing bucket
 * GET /v1/crm/dashboard/follow-up-compliance  — on-time vs overdue next_actions by owner
 * GET /v1/crm/dashboard/conversion-funnel     — count + % at each stage transition
 * GET /v1/crm/dashboard/won-lost-analysis     — won vs lost with cycle length
 * GET /v1/crm/dashboard/dormant-accounts      — accounts with no recent activity
 * GET /v1/crm/dashboard/cross-sell-signals    — accounts with product whitespace
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { listQuery, windowOf } from "../../shared/list-query.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin", "sales_officer"];

const periodEnum = z.enum(["day", "week", "month"]).default("month");
const optionalUuid = z.string().uuid().optional();

// ── Gap 3: Lead response time ──
const leadResponseTimeQuery = z.object({
  period: periodEnum,
  source: z.string().max(64).optional(),
  ownerId: optionalUuid,
});

// ── Gap 3: Follow-up compliance ──
const followUpComplianceQuery = z.object({
  ownerId: optionalUuid,
});

// ── Gap 4: Conversion funnel ──
const conversionFunnelQuery = z.object({
  period: periodEnum,
  source: z.string().max(64).optional(),
  ownerId: optionalUuid,
  campaign: z.string().max(128).optional(),
  product: z.string().max(160).optional(),
  geography: z.string().max(100).optional(),
  segment: z.string().max(64).optional(),
});

// ── Gap 7: Won/lost analysis ──
const wonLostQuery = z.object({
  period: periodEnum,
  reason: z.string().max(200).optional(),
  competitor: z.string().max(120).optional(),
});

// ── Gap 9: Dormant accounts ──
const dormantAccountsQuery = listQuery.extend({
  inactiveDays: z.coerce.number().int().min(1).max(3650).default(90),
});

// ── Gap 9: Cross-sell signals ──
const crossSellQuery = listQuery;

function periodTrunc(period: string): string {
  switch (period) {
    case "day": return "day";
    case "week": return "week";
    case "month": return "month";
    default: return "month";
  }
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  // ═══════════════════════════════════════════════════════════════════════════
  // Gap 3: Lead response time
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/v1/crm/dashboard/lead-response-time", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = leadResponseTimeQuery.parse(req.query);
    const trunc = periodTrunc(q.period);

    const data = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT
          date_trunc(${trunc}, c.created_at)::text AS period,
          round(avg(EXTRACT(EPOCH FROM (a.created_at - c.created_at)) / 3600)::numeric, 2)::float AS "avgHours",
          count(DISTINCT c.id)::int AS "leadCount"
        FROM crm.contacts c
        INNER JOIN LATERAL (
          SELECT created_at FROM crm.activities
          WHERE contact_id = c.id AND tenant_id = ${ctx.tenantId}
          ORDER BY created_at ASC LIMIT 1
        ) a ON true
        WHERE c.tenant_id = ${ctx.tenantId}
          AND c.lead_status IS NOT NULL
          ${q.source ? sql`AND c.lead_source = ${q.source}` : sql``}
          ${q.ownerId ? sql`AND c.owner_id = ${q.ownerId}` : sql``}
        GROUP BY 1
        ORDER BY 1 DESC
      `) as unknown as Array<{ period: string; avgHours: number; leadCount: number }>;
    });

    return reply.send({ data, meta: { period: q.period } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Gap 3: Lead ageing
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/v1/crm/dashboard/lead-ageing", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);

    const data = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT bucket, count::int
        FROM (
          SELECT
            CASE
              WHEN age <= interval '24 hours' THEN '0-24h'
              WHEN age <= interval '3 days' THEN '1-3d'
              WHEN age <= interval '7 days' THEN '3-7d'
              WHEN age <= interval '14 days' THEN '7-14d'
              WHEN age <= interval '30 days' THEN '14-30d'
              ELSE '30d+'
            END AS bucket,
            CASE
              WHEN age <= interval '24 hours' THEN 1
              WHEN age <= interval '3 days' THEN 2
              WHEN age <= interval '7 days' THEN 3
              WHEN age <= interval '14 days' THEN 4
              WHEN age <= interval '30 days' THEN 5
              ELSE 6
            END AS sort_order,
            count(*)::int AS count
          FROM (
            SELECT now() - created_at AS age
            FROM crm.contacts
            WHERE tenant_id = ${ctx.tenantId}
              AND lead_status NOT IN ('converted', 'disqualified', 'customer')
              AND status = 'active'
          ) sub
          GROUP BY 1, 2
        ) grouped
        ORDER BY sort_order
      `) as unknown as Array<{ bucket: string; count: number }>;
    });

    return reply.send({ data, meta: { total: data.reduce((s, r) => s + r.count, 0) } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Gap 3: Follow-up compliance
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/v1/crm/dashboard/follow-up-compliance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = followUpComplianceQuery.parse(req.query);

    const data = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT
          created_by AS "ownerId",
          count(*) FILTER (WHERE completed_at IS NOT NULL AND completed_at <= due_at)::int AS "onTime",
          count(*) FILTER (WHERE completed_at IS NOT NULL AND completed_at > due_at)::int AS "overdue",
          count(*) FILTER (WHERE completed_at IS NULL AND due_at < now())::int AS "pastDueOpen",
          count(*)::int AS total,
          CASE WHEN count(*) > 0
            THEN round(
              (count(*) FILTER (WHERE completed_at IS NOT NULL AND completed_at <= due_at))::numeric
              / count(*)::numeric * 100, 1
            )::float
            ELSE 0
          END AS "compliancePercent"
        FROM crm.next_actions
        WHERE tenant_id = ${ctx.tenantId}
          ${q.ownerId ? sql`AND created_by = ${q.ownerId}` : sql``}
        GROUP BY created_by
        ORDER BY "compliancePercent" ASC
      `) as unknown as Array<{
        ownerId: string;
        onTime: number;
        overdue: number;
        pastDueOpen: number;
        total: number;
        compliancePercent: number;
      }>;
    });

    return reply.send({ data, meta: { total: data.length } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Gap 4: Conversion funnel
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/v1/crm/dashboard/conversion-funnel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = conversionFunnelQuery.parse(req.query);
    const trunc = periodTrunc(q.period);

    const data = await scopedRead(async (tx) => {
      // Count transitions between the canonical funnel stages
      const rows = await tx.execute(sql`
        SELECT
          date_trunc(${trunc}, lt.created_at)::text AS period,
          lt.from_status AS "fromStatus",
          lt.to_status AS "toStatus",
          count(*)::int AS count
        FROM crm.lead_transitions lt
        INNER JOIN crm.contacts c ON c.id = lt.contact_id AND c.tenant_id = lt.tenant_id
        LEFT JOIN crm.deals d ON d.contact_id = c.id AND d.tenant_id = c.tenant_id
        WHERE lt.tenant_id = ${ctx.tenantId}
          ${q.source ? sql`AND c.lead_source = ${q.source}` : sql``}
          ${q.ownerId ? sql`AND c.owner_id = ${q.ownerId}` : sql``}
          ${q.campaign ? sql`AND c.utm_campaign = ${q.campaign}` : sql``}
          ${q.product ? sql`AND d.product = ${q.product}` : sql``}
          ${q.geography ? sql`AND c.city = ${q.geography}` : sql``}
          ${q.segment ? sql`AND c.lead_status = ${q.segment}` : sql``}
        GROUP BY 1, 2, 3
        ORDER BY 1 DESC, count DESC
      `) as unknown as Array<{
        period: string;
        fromStatus: string;
        toStatus: string;
        count: number;
      }>;

      // Also get the total leads created per period for the rate calc
      const totals = await tx.execute(sql`
        SELECT
          date_trunc(${trunc}, c.created_at)::text AS period,
          count(*)::int AS total
        FROM crm.contacts c
        LEFT JOIN crm.deals d ON d.contact_id = c.id AND d.tenant_id = c.tenant_id
        WHERE c.tenant_id = ${ctx.tenantId}
          AND c.lead_status IS NOT NULL
          ${q.source ? sql`AND c.lead_source = ${q.source}` : sql``}
          ${q.ownerId ? sql`AND c.owner_id = ${q.ownerId}` : sql``}
          ${q.campaign ? sql`AND c.utm_campaign = ${q.campaign}` : sql``}
          ${q.product ? sql`AND d.product = ${q.product}` : sql``}
          ${q.geography ? sql`AND c.city = ${q.geography}` : sql``}
          ${q.segment ? sql`AND c.lead_status = ${q.segment}` : sql``}
        GROUP BY 1
      `) as unknown as Array<{ period: string; total: number }>;

      const totalMap = new Map(totals.map((t) => [t.period, t.total]));

      return rows.map((r) => {
        const periodTotal = totalMap.get(r.period) ?? 0;
        return {
          ...r,
          percent: periodTotal > 0
            ? Math.round((r.count / periodTotal) * 1000) / 10
            : 0,
        };
      });
    });

    return reply.send({ data, meta: { period: q.period } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Gap 7: Won/lost analysis
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/v1/crm/dashboard/won-lost-analysis", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = wonLostQuery.parse(req.query);
    const trunc = periodTrunc(q.period);

    const data = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT
          date_trunc(${trunc}, d.updated_at)::text AS period,
          d.close_outcome AS outcome,
          d.close_reason AS reason,
          count(*)::int AS count,
          round(avg(
            EXTRACT(EPOCH FROM (d.updated_at - d.created_at)) / 86400
          )::numeric, 1)::float AS "avgCycleDays"
        FROM crm.deals d
        WHERE d.tenant_id = ${ctx.tenantId}
          AND d.close_outcome IN ('won', 'lost')
          ${q.reason ? sql`AND d.close_reason ILIKE ${"%" + q.reason + "%"}` : sql``}
          ${q.competitor ? sql`AND d.close_competitor::text ILIKE ${"%" + q.competitor + "%"}` : sql``}
        GROUP BY 1, 2, 3
        ORDER BY 1 DESC, count DESC
      `) as unknown as Array<{
        period: string;
        outcome: string;
        reason: string | null;
        count: number;
        avgCycleDays: number;
      }>;
    });

    // Compute totals for summary
    let wonCount = 0;
    let lostCount = 0;
    for (const row of data) {
      if (row.outcome === "won") wonCount += row.count;
      else lostCount += row.count;
    }

    return reply.send({
      data,
      meta: {
        period: q.period,
        total: wonCount + lostCount,
        wonCount,
        lostCount,
        winRate: wonCount + lostCount > 0
          ? Math.round((wonCount / (wonCount + lostCount)) * 1000) / 10
          : 0,
      },
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Gap 9: Dormant accounts
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/v1/crm/dashboard/dormant-accounts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = dormantAccountsQuery.parse(req.query);
    const w = windowOf(q);

    const { rows, total } = await scopedRead(async (tx) => {
      const data = await tx.execute(sql`
        SELECT
          a.id,
          a.name,
          a.industry,
          max(act.created_at)::text AS "lastActivityAt",
          EXTRACT(EPOCH FROM (now() - COALESCE(max(act.created_at), a.created_at)) / 86400)::int AS "inactiveDays"
        FROM crm.accounts a
        LEFT JOIN crm.activities act
          ON act.account_id = a.id AND act.tenant_id = ${ctx.tenantId}
        WHERE a.tenant_id = ${ctx.tenantId}
          AND a.status = 'active'
        GROUP BY a.id, a.name, a.industry, a.created_at
        HAVING COALESCE(max(act.created_at), a.created_at) < now() - make_interval(days => ${q.inactiveDays})
        ORDER BY "inactiveDays" DESC
        LIMIT ${w.pageSize} OFFSET ${w.offset}
      `) as unknown as Array<{
        id: string;
        name: string;
        industry: string | null;
        lastActivityAt: string | null;
        inactiveDays: number;
      }>;

      const counted = await tx.execute(sql`
        SELECT count(*)::int AS total
        FROM (
          SELECT a.id
          FROM crm.accounts a
          LEFT JOIN crm.activities act
            ON act.account_id = a.id AND act.tenant_id = ${ctx.tenantId}
          WHERE a.tenant_id = ${ctx.tenantId}
            AND a.status = 'active'
          GROUP BY a.id, a.created_at
          HAVING COALESCE(max(act.created_at), a.created_at) < now() - make_interval(days => ${q.inactiveDays})
        ) sub
      `) as unknown as Array<{ total: number }>;

      return { rows: data, total: counted[0]?.total ?? 0 };
    });

    return reply.send({ data: rows, meta: { page: w.page, pageSize: w.pageSize, total } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Gap 9: Cross-sell signals
  // ═══════════════════════════════════════════════════════════════════════════
  app.get("/v1/crm/dashboard/cross-sell-signals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = crossSellQuery.parse(req.query);
    const w = windowOf(q);

    const { rows, total } = await scopedRead(async (tx) => {
      // Get accounts that have deals in only a subset of the tenant's product categories
      const data = await tx.execute(sql`
        WITH tenant_products AS (
          SELECT DISTINCT product
          FROM crm.deals
          WHERE tenant_id = ${ctx.tenantId}
            AND product IS NOT NULL
            AND status IN ('active', 'won')
        ),
        account_products AS (
          SELECT
            d.contact_id,
            c.account_id,
            array_agg(DISTINCT d.product) FILTER (WHERE d.product IS NOT NULL) AS products,
            count(DISTINCT d.product) FILTER (WHERE d.product IS NOT NULL) AS "productCount"
          FROM crm.deals d
          INNER JOIN crm.contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
          WHERE d.tenant_id = ${ctx.tenantId}
            AND d.product IS NOT NULL
            AND d.status IN ('active', 'won')
            AND c.account_id IS NOT NULL
          GROUP BY d.contact_id, c.account_id
        )
        SELECT
          a.id AS "accountId",
          a.name AS "accountName",
          ap.products AS "currentProducts",
          ap."productCount",
          (SELECT count(*) FROM tenant_products)::int AS "totalCategories",
          (SELECT count(*) FROM tenant_products)::int - ap."productCount"::int AS "whitespaceCount"
        FROM account_products ap
        INNER JOIN crm.accounts a ON a.id = ap.account_id AND a.tenant_id = ${ctx.tenantId}
        WHERE ap."productCount" < (SELECT count(*) FROM tenant_products)
        ORDER BY "whitespaceCount" DESC
        LIMIT ${w.pageSize} OFFSET ${w.offset}
      `) as unknown as Array<{
        accountId: string;
        accountName: string;
        currentProducts: string[];
        productCount: number;
        totalCategories: number;
        whitespaceCount: number;
      }>;

      const counted = await tx.execute(sql`
        WITH tenant_products AS (
          SELECT DISTINCT product
          FROM crm.deals
          WHERE tenant_id = ${ctx.tenantId}
            AND product IS NOT NULL
            AND status IN ('active', 'won')
        ),
        account_products AS (
          SELECT
            c.account_id,
            count(DISTINCT d.product) FILTER (WHERE d.product IS NOT NULL) AS "productCount"
          FROM crm.deals d
          INNER JOIN crm.contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
          WHERE d.tenant_id = ${ctx.tenantId}
            AND d.product IS NOT NULL
            AND d.status IN ('active', 'won')
            AND c.account_id IS NOT NULL
          GROUP BY c.account_id
        )
        SELECT count(*)::int AS total
        FROM account_products
        WHERE "productCount" < (SELECT count(*) FROM tenant_products)
      `) as unknown as Array<{ total: number }>;

      return { rows: data, total: counted[0]?.total ?? 0 };
    });

    return reply.send({ data: rows, meta: { page: w.page, pageSize: w.pageSize, total } });
  });
}
