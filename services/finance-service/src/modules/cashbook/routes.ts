import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

export async function cashBookRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/finance/cash-book — list cash book entries
  app.get("/v1/finance/cash-book", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      type: z.enum(["cash", "bank"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const fromDate = q.from ?? "1900-01-01";
    const toDate = q.to ?? "2099-12-31";
    const bankOrCash = q.type ?? null;

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT cb.id, cb.entry_date, cb.voucher_type, cb.voucher_no, cb.particulars,
             cb.receipt_minor, cb.payment_minor, cb.balance_minor, cb.bank_or_cash, cb.reference, cb.created_at,
             j.id AS journal_id
      FROM gl.finance_cash_book cb
      -- GAP-FINANCE-TREASURY-CASH-BANK-05: the GL voucher behind the entry (voucher_no is
      -- unique per tenant in gl.finance_journals), so the UI can open the voucher.
      LEFT JOIN gl.finance_journals j
        ON j.tenant_id = cb.tenant_id AND j.voucher_no = cb.voucher_no
      WHERE cb.tenant_id = ${ctx.tenantId}::uuid
        AND cb.entry_date >= ${fromDate}::date
        AND cb.entry_date <= ${toDate}::date
        AND (${bankOrCash}::text IS NULL OR cb.bank_or_cash = ${bankOrCash})
      ORDER BY cb.entry_date DESC, cb.created_at DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `));

    return reply.send({ data: rows });
  });

  // GET /v1/finance/cash-book/balance — current cash/bank balance
  app.get("/v1/finance/cash-book/balance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT bank_or_cash,
             COALESCE(SUM(receipt_minor), 0)::bigint AS total_receipts,
             COALESCE(SUM(payment_minor), 0)::bigint AS total_payments,
             (COALESCE(SUM(receipt_minor), 0) - COALESCE(SUM(payment_minor), 0))::bigint AS balance
      FROM gl.finance_cash_book
      WHERE tenant_id = ${ctx.tenantId}::uuid
      GROUP BY bank_or_cash
    `));

    return reply.send({ data: rows });
  });

  // GET /v1/finance/voucher-types — list voucher types
  app.get("/v1/finance/voucher-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT id, code, name, nature, auto_number_prefix, is_active, created_at
      FROM gl.finance_voucher_types
      WHERE tenant_id = ${ctx.tenantId}::uuid
      ORDER BY code
    `));

    return reply.send({ data: rows });
  });
}
