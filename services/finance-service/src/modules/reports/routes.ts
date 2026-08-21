import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, financeErrorHandler } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import * as periodRepo from "../period-close/repo.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

function deriveFY(period: string): string {
  const year = parseInt(period.slice(0, 4), 10);
  const month = parseInt(period.slice(5, 7), 10);
  const fyStart = month >= 4 ? year : year - 1;
  return `${fyStart}-${String(fyStart + 1).slice(2)}`;
}

function deriveFYFromDate(d = new Date()): string {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const fyStart = month >= 4 ? year : year - 1;
  return `${fyStart}-${String(fyStart + 1).slice(2)}`;
}

export async function reportsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/reports/expenditure-statement", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { fiscalYear } = z.object({ fiscalYear: z.string().optional() }).parse(req.query);
    const fy = fiscalYear ?? deriveFYFromDate();

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT fh.code, fh.name,
        COALESCE(hu.expended_minor, 0)::bigint AS expenditure_minor
      FROM budget.finance_heads fh
      LEFT JOIN budget.head_utilisation hu
        ON hu.tenant_id = fh.tenant_id AND hu.head_id = fh.id AND hu.fy = ${fy}::bpchar
      WHERE fh.tenant_id = ${ctx.tenantId}::uuid
      ORDER BY fh.code
    `));

    const result = rows as unknown as Array<{ code: string; name: string; expenditure_minor: string }>;
    return reply.send({
      fiscalYear: fy,
      rows: result.map((r) => ({
        code: r.code,
        name: r.name,
        expenditureMinor: r.expenditure_minor,
        expenditureRupees: Number(r.expenditure_minor) / 100,
      })),
    });
  });

  app.get("/v1/finance/reports/budget-utilisation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { fiscalYear } = z.object({ fiscalYear: z.string().optional() }).parse(req.query);
    const fy = fiscalYear ?? deriveFYFromDate();

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT fh.code, fh.name,
        COALESCE(hu.allocated_minor, 0) AS sanctioned_amount_minor,
        COALESCE(hu.committed_minor, 0) AS released_amount_minor,
        COALESCE(hu.expended_minor, 0)::bigint AS expended_minor,
        ROUND(COALESCE(hu.expended_minor, 0)::numeric /
          NULLIF(hu.allocated_minor, 0) * 100, 2) AS utilisation_pct
      FROM budget.finance_heads fh
      LEFT JOIN budget.head_utilisation hu
        ON hu.tenant_id = fh.tenant_id AND hu.head_id = fh.id AND hu.fy = ${fy}::bpchar
      WHERE fh.tenant_id = ${ctx.tenantId}::uuid
      ORDER BY fh.code
    `));

    return reply.send({ fiscalYear: fy, rows: rows as unknown[] });
  });


  // GET /v1/finance/reports/variance — variance report: budgeted vs actual, per head
  app.get("/v1/finance/reports/variance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { fiscalYear } = z.object({ fiscalYear: z.string().optional() }).parse(req.query);
    const fy = fiscalYear ?? deriveFYFromDate();

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT fh.code, fh.name,
        COALESCE(hu.allocated_minor, 0)::bigint         AS budgeted_minor,
        COALESCE(hu.expended_minor,  0)::bigint         AS actual_minor,
        COALESCE(hu.allocated_minor, 0) -
          COALESCE(hu.expended_minor, 0)                AS variance_minor,
        ROUND(
          COALESCE(hu.expended_minor, 0)::numeric /
          NULLIF(hu.allocated_minor, 0) * 100, 2
        )                                               AS utilisation_pct
      FROM budget.finance_heads fh
      LEFT JOIN budget.head_utilisation hu
        ON  hu.tenant_id = fh.tenant_id
        AND hu.head_id   = fh.id
        AND hu.fy        = ${fy}::bpchar
      WHERE fh.tenant_id = ${ctx.tenantId}::uuid
      ORDER BY fh.code
    `));

    const result = rows as unknown as Array<{
      code: string; name: string;
      budgeted_minor: string; actual_minor: string;
      variance_minor: string; utilisation_pct: string | null;
    }>;

    return reply.send({
      fiscalYear: fy,
      rows: result.map((r) => ({
        code: r.code,
        name: r.name,
        budgetedMinor:   r.budgeted_minor,
        actualMinor:     r.actual_minor,
        varianceMinor:   r.variance_minor,
        utilisationPct:  r.utilisation_pct !== null ? parseFloat(r.utilisation_pct) : null,
        status: r.variance_minor.startsWith("-") ? "overspent" : "within_budget",
      })),
    });
  });

  app.setErrorHandler(financeErrorHandler);
}

export { deriveFY, deriveFYFromDate };
