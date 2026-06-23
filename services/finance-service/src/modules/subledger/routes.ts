import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

export async function subLedgerRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/finance/ap/aging — vendor-wise payable aging
  app.get("/v1/finance/ap/aging", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      status: z.enum(["open", "partial", "paid", "overdue"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const rows = await db.execute(sql`
      SELECT vendor_id, vendor_name, aging_bucket,
             COUNT(*)::int AS bill_count,
             COALESCE(SUM(balance_minor), 0)::bigint AS total_outstanding
      FROM gl.finance_ap_ledger
      WHERE tenant_id = ${ctx.tenantId}::uuid
        AND (${q.status ?? null}::text IS NULL OR status = ${q.status ?? null})
        AND status != 'paid'
      GROUP BY vendor_id, vendor_name, aging_bucket
      ORDER BY aging_bucket, vendor_name
      LIMIT ${q.limit} OFFSET ${q.offset}
    `);

    return reply.send({ data: rows });
  });

  // GET /v1/finance/ar/aging — debtor-wise receivable aging
  app.get("/v1/finance/ar/aging", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      status: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const rows = await db.execute(sql`
      SELECT debtor_id, debtor_name, aging_bucket,
             COUNT(*)::int AS invoice_count,
             COALESCE(SUM(balance_minor), 0)::bigint AS total_outstanding
      FROM gl.finance_ar_ledger
      WHERE tenant_id = ${ctx.tenantId}::uuid
        AND (${q.status ?? null}::text IS NULL OR status = ${q.status ?? null})
        AND status != 'paid'
      GROUP BY debtor_id, debtor_name, aging_bucket
      ORDER BY aging_bucket, debtor_name
      LIMIT ${q.limit} OFFSET ${q.offset}
    `);

    return reply.send({ data: rows });
  });

  // GET /v1/finance/commitments — commitment register
  app.get("/v1/finance/commitments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      fy: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      status: z.enum(["active", "partially_released", "fully_released", "cancelled"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const rows = await db.execute(sql`
      SELECT id, budget_head_id, reference_type, reference_id, reference_no,
             committed_minor, released_minor, balance_minor, fy, status, committed_at
      FROM budget.finance_commitments
      WHERE tenant_id = ${ctx.tenantId}::uuid
        AND (${q.fy ?? null}::text IS NULL OR fy = ${q.fy ?? null})
        AND (${q.status ?? null}::text IS NULL OR status = ${q.status ?? null})
      ORDER BY committed_at DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `);

    return reply.send({ data: rows });
  });
}
