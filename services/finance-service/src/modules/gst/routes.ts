import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

export async function gstRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/finance/gst/ledger — GST transactions
  app.get("/v1/finance/gst/ledger", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      direction: z.enum(["input", "output"]).optional(),
      gstType: z.enum(["CGST", "SGST", "IGST", "CESS"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT id, invoice_id, invoice_no, invoice_date, party_gstin, party_name,
             gst_type, direction, taxable_minor, tax_minor, rate_pct, hsn_code,
             period, status, created_at
      FROM gl.finance_gst_ledger
      WHERE tenant_id = ${ctx.tenantId}::uuid
        AND (${q.period ?? null}::text IS NULL OR period = ${q.period ?? null})
        AND (${q.direction ?? null}::text IS NULL OR direction = ${q.direction ?? null})
        AND (${q.gstType ?? null}::text IS NULL OR gst_type = ${q.gstType ?? null})
      ORDER BY invoice_date DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `));

    return reply.send({ data: rows });
  });

  // GET /v1/finance/gst/summary — CGST/SGST/IGST summary for a period
  app.get("/v1/finance/gst/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/),
    }).parse(req.query);

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT gst_type, direction,
             COALESCE(SUM(taxable_minor), 0)::bigint AS total_taxable,
             COALESCE(SUM(tax_minor), 0)::bigint AS total_tax,
             COUNT(*)::int AS transaction_count
      FROM gl.finance_gst_ledger
      WHERE tenant_id = ${ctx.tenantId}::uuid AND period = ${q.period}
      GROUP BY gst_type, direction
      ORDER BY direction, gst_type
    `));

    return reply.send({ period: q.period, summary: rows });
  });

  // GET /v1/finance/gst/itc-reconciliation — ITC vs liability
  app.get("/v1/finance/gst/itc-reconciliation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/),
    }).parse(req.query);

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT gst_type,
             COALESCE(SUM(CASE WHEN direction = 'input' THEN tax_minor ELSE 0 END), 0)::bigint AS itc_available,
             COALESCE(SUM(CASE WHEN direction = 'output' THEN tax_minor ELSE 0 END), 0)::bigint AS output_liability,
             (COALESCE(SUM(CASE WHEN direction = 'output' THEN tax_minor ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN direction = 'input' THEN tax_minor ELSE 0 END), 0))::bigint AS net_payable
      FROM gl.finance_gst_ledger
      WHERE tenant_id = ${ctx.tenantId}::uuid AND period = ${q.period}
      GROUP BY gst_type
      ORDER BY gst_type
    `));

    return reply.send({ period: q.period, reconciliation: rows });
  });
}
