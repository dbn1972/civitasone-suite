import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
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

    const rows = await db.execute(sql`
      SELECT fh.code, fh.name,
        COALESCE(SUM(p.amount_minor), 0)::bigint AS expenditure_minor
      FROM budget.finance_heads fh
      JOIN budget.finance_budgets fb ON fb.head_id = fh.id AND fb.tenant_id = fh.tenant_id AND fb.fy = ${fy}
      LEFT JOIN payments.finance_bills b ON b.head_id = fh.id AND b.tenant_id = fh.tenant_id
      LEFT JOIN payments.finance_payments p ON p.bill_id = b.id
        AND p.tenant_id = ${ctx.tenantId}::uuid AND p.status = 'paid'
      WHERE fh.tenant_id = ${ctx.tenantId}::uuid
      GROUP BY fh.id, fh.code, fh.name ORDER BY fh.code
    `);

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

    const rows = await db.execute(sql`
      SELECT fh.code, fh.name,
        fb.allocated_minor AS sanctioned_amount_minor,
        fb.utilised_minor AS released_amount_minor,
        COALESCE(SUM(p.amount_minor), 0)::bigint AS expended_minor,
        ROUND(COALESCE(SUM(p.amount_minor), 0)::numeric /
          NULLIF(fb.allocated_minor, 0) * 100, 2) AS utilisation_pct
      FROM budget.finance_heads fh
      JOIN budget.finance_budgets fb ON fb.head_id = fh.id AND fb.tenant_id = fh.tenant_id AND fb.fy = ${fy}
      LEFT JOIN payments.finance_bills b ON b.head_id = fh.id AND b.tenant_id = fh.tenant_id
      LEFT JOIN payments.finance_payments p ON p.bill_id = b.id
        AND p.tenant_id = ${ctx.tenantId}::uuid AND p.status = 'paid'
      WHERE fh.tenant_id = ${ctx.tenantId}::uuid
      GROUP BY fh.id, fh.code, fh.name, fb.allocated_minor, fb.utilised_minor
      ORDER BY fh.code
    `);

    return reply.send({ fiscalYear: fy, rows: rows as unknown[] });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

export { deriveFY, deriveFYFromDate };
