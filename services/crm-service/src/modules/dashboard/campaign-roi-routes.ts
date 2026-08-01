/**
 * Campaign responses, cost and ROI routes (MK-004).
 * GET /v1/crm/campaigns/roi-summary        — ROI across all campaigns
 * GET /v1/crm/campaigns/:id/roi            — ROI for one campaign
 * PUT /v1/crm/campaigns/:id/performance    — upsert a period's numbers
 *
 * MONEY: cost/revenue are bigint paise carried as STRINGS. ROI is an integer
 * basis-points value (1 bp = 0.01%) computed with BigInt — never a float.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead, db } from "../../shared/db.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { listQuery, windowOf } from "../../shared/list-query.js";
import { EVENTS } from "../../topics.js";
import {
  computeRoi,
  computeNetMinor,
  costPerResponse,
  formatBasisPoints,
  ROI_UNDEFINED,
} from "./roi-domain.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];
const RESOURCE = "campaign_performance";

const idParam = z.object({ id: z.string().uuid() });

const minorAmount = z.string().regex(/^\d{1,25}$/, "must be a non-negative integer string of minor units");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)");

const upsertBody = z.object({
  responses: z.number().int().min(0).max(100_000_000).default(0),
  costMinor: minorAmount.default("0"),
  revenueMinor: minorAmount.default("0"),
  currency: z.string().length(3).default("INR"),
  periodStart: isoDate,
  periodEnd: isoDate.optional(),
}).refine(
  (b) => b.periodEnd === undefined || b.periodEnd >= b.periodStart,
  { message: "periodEnd must not precede periodStart" },
);

const summaryQuery = listQuery;

interface PerfRow {
  campaignId: string;
  responses: number;
  costMinor: string;
  revenueMinor: string;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
}

/** Shapes a ROI response: money as strings, ROI as integer basis points. */
function roiView(costMinor: bigint, revenueMinor: bigint, responses: number) {
  const roiBps = computeRoi(costMinor, revenueMinor);
  return {
    costMinor: costMinor.toString(),
    revenueMinor: revenueMinor.toString(),
    netMinor: computeNetMinor(costMinor, revenueMinor).toString(),
    responses,
    // null when cost is zero — ROI is undefined, not zero and not infinite.
    roiBasisPoints: roiBps === ROI_UNDEFINED ? null : roiBps.toString(),
    roiPercent: formatBasisPoints(roiBps),
    costPerResponseMinor: costPerResponse(costMinor, responses)?.toString() ?? null,
  };
}

export async function campaignRoiRoutes(app: FastifyInstance): Promise<void> {
  /** ROI across all campaigns, one row per campaign (periods aggregated). */
  app.get("/v1/crm/campaigns/roi-summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = summaryQuery.parse(req.query ?? {});
    const w = windowOf(q);

    const { rows, total } = await scopedRead(async (tx) => {
      const data = await tx.execute(sql`
        SELECT campaign_id            AS "campaignId",
               sum(responses)::int    AS responses,
               sum(cost_minor)::text  AS "costMinor",
               sum(revenue_minor)::text AS "revenueMinor",
               min(currency)          AS currency,
               count(*)::int          AS periods
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

    const data = rows.map((r) => ({
      campaignId: r.campaignId,
      currency: r.currency,
      periods: r.periods,
      ...roiView(BigInt(r.costMinor), BigInt(r.revenueMinor), r.responses),
    }));

    return reply.send({ data, meta: { page: w.page, pageSize: w.pageSize, total } });
  });

  /** ROI for a single campaign, with its per-period breakdown. */
  app.get("/v1/crm/campaigns/:id/roi", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const rows = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT campaign_id           AS "campaignId",
               responses,
               cost_minor::text      AS "costMinor",
               revenue_minor::text   AS "revenueMinor",
               currency,
               period_start          AS "periodStart",
               period_end            AS "periodEnd"
        FROM crm.campaign_performance
        WHERE tenant_id = ${ctx.tenantId} AND campaign_id = ${id}
        ORDER BY period_start ASC NULLS LAST
      `) as unknown as PerfRow[];
    });

    if (rows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "no performance data recorded for this campaign");
    }

    let costTotal = 0n;
    let revenueTotal = 0n;
    let responsesTotal = 0;
    for (const r of rows) {
      costTotal += BigInt(r.costMinor);
      revenueTotal += BigInt(r.revenueMinor);
      responsesTotal += r.responses;
    }

    return reply.send({
      data: {
        campaignId: id,
        currency: rows[0]?.currency ?? "INR",
        ...roiView(costTotal, revenueTotal, responsesTotal),
        periods: rows.map((r) => ({
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          ...roiView(BigInt(r.costMinor), BigInt(r.revenueMinor), r.responses),
        })),
      },
    });
  });

  /**
   * Upsert one period's numbers. Idempotent on (campaign, periodStart) so a
   * replayed marketing feed corrects the row instead of double-counting spend.
   */
  app.put("/v1/crm/campaigns/:id/performance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = upsertBody.parse(req.body);

    // BigInt round-trip validates exactness before the value reaches SQL.
    const costMinor = BigInt(body.costMinor).toString();
    const revenueMinor = BigInt(body.revenueMinor).toString();
    const rowId = randomUUID();

    const saved = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        INSERT INTO crm.campaign_performance
          (id, tenant_id, campaign_id, responses, cost_minor, revenue_minor, currency,
           period_start, period_end, created_by, updated_by)
        VALUES (
          ${rowId}, ${ctx.tenantId}, ${id}, ${body.responses},
          ${costMinor}::bigint, ${revenueMinor}::bigint, ${body.currency.toUpperCase()},
          ${body.periodStart}::date, ${body.periodEnd ?? null}::date,
          ${ctx.actorId}, ${ctx.actorId}
        )
        ON CONFLICT (tenant_id, campaign_id, period_start) DO UPDATE
        SET responses = EXCLUDED.responses,
            cost_minor = EXCLUDED.cost_minor,
            revenue_minor = EXCLUDED.revenue_minor,
            currency = EXCLUDED.currency,
            period_end = EXCLUDED.period_end,
            updated_at = now(),
            updated_by = ${ctx.actorId},
            version = crm.campaign_performance.version + 1
        RETURNING id, version
      `) as unknown as Array<{ id: string; version: number }>;
      const row = rows[0];
      if (!row) return rows;
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.campaignPerformanceRecorded,
        action: "upsert",
        resourceType: RESOURCE,
        resourceId: row.id,
        payload: {
          performanceId: row.id,
          campaignId: id,
          periodStart: body.periodStart,
          responses: body.responses,
          costMinor,
          revenueMinor,
          currency: body.currency.toUpperCase(),
        },
      });
      return rows;
    });

    const row = saved[0];
    if (!row) {
      throw new HttpError(409, "CONFLICT", "campaign performance row could not be written");
    }

    return reply.send({
      data: {
        id: row.id,
        campaignId: id,
        periodStart: body.periodStart,
        periodEnd: body.periodEnd ?? null,
        currency: body.currency.toUpperCase(),
        ...roiView(BigInt(costMinor), BigInt(revenueMinor), body.responses),
        version: row.version,
      },
    });
  });
}
