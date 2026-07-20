import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { encryptPii, decryptPii } from "../../shared/pii-crypto.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

export async function vendorTdsRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/finance/vendor-tds — list TDS deductions
  app.get("/v1/finance/vendor-tds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      fy: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional(),
      status: z.enum(["deducted", "deposited", "filed"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT id, vendor_id, vendor_name, pan, bill_id, payment_id, section,
             gross_amount_minor, tds_rate_pct, tds_amount_minor, surcharge_minor,
             cess_minor, net_payment_minor, deduction_date, deposit_date,
             challan_no, quarter, fy, status, created_at
      FROM gl.finance_vendor_tds
      WHERE tenant_id = ${ctx.tenantId}::uuid
        AND (${q.fy ?? null}::text IS NULL OR fy = ${q.fy ?? null})
        AND (${q.quarter ?? null}::text IS NULL OR quarter = ${q.quarter ?? null})
        AND (${q.status ?? null}::text IS NULL OR status = ${q.status ?? null})
      ORDER BY deduction_date DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `));

    // Decrypt PAN in result rows (transparent to callers)
    const decryptedRows = (rows as Record<string, unknown>[]).map((row) => ({
      ...row,
      pan: row.pan ? decryptPii(row.pan as string) : null,
    }));

    return reply.send({ data: decryptedRows });
  });

  // POST /v1/finance/vendor-tds — record a TDS deduction
  app.post("/v1/finance/vendor-tds", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const body = z.object({
      vendorId: z.string().uuid(),
      vendorName: z.string().max(256).optional(),
      pan: z.string().max(10).optional(),
      billId: z.string().uuid().optional(),
      paymentId: z.string().uuid().optional(),
      section: z.string().max(10).default("194C"),
      grossAmountMinor: z.number().int().positive(),
      tdsRatePct: z.number().min(0).max(100).default(2.0),
      tdsAmountMinor: z.number().int().min(0),
      surchargeMinor: z.number().int().min(0).default(0),
      cessMinor: z.number().int().min(0).default(0),
      netPaymentMinor: z.number().int().min(0),
      deductionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
      fy: z.string().regex(/^\d{4}-\d{2}$/),
    }).parse(req.body);

    const encryptedPan = body.pan ? encryptPii(body.pan) : null;

    const rows = await db.execute(sql`
      INSERT INTO gl.finance_vendor_tds (
        tenant_id, vendor_id, vendor_name, pan, bill_id, payment_id, section,
        gross_amount_minor, tds_rate_pct, tds_amount_minor, surcharge_minor,
        cess_minor, net_payment_minor, deduction_date, quarter, fy
      ) VALUES (
        ${ctx.tenantId}::uuid, ${body.vendorId}::uuid, ${body.vendorName ?? null},
        ${encryptedPan}, ${body.billId ?? null}::uuid, ${body.paymentId ?? null}::uuid,
        ${body.section}, ${body.grossAmountMinor}, ${body.tdsRatePct},
        ${body.tdsAmountMinor}, ${body.surchargeMinor}, ${body.cessMinor},
        ${body.netPaymentMinor}, ${body.deductionDate}::date, ${body.quarter}, ${body.fy}
      )
      RETURNING id, vendor_id, section, tds_amount_minor, deduction_date, status
    `);

    return reply.code(201).send({ data: (rows as unknown[])[0] });
  });

  // GET /v1/finance/vendor-tds/form-26q — generate Form 26Q data
  app.get("/v1/finance/vendor-tds/form-26q", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      fy: z.string().regex(/^\d{4}-\d{2}$/),
      quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
    }).parse(req.query);

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT vendor_name, pan, section,
             SUM(gross_amount_minor)::bigint AS total_gross,
             SUM(tds_amount_minor)::bigint AS total_tds,
             SUM(surcharge_minor)::bigint AS total_surcharge,
             SUM(cess_minor)::bigint AS total_cess,
             COUNT(*)::int AS deduction_count
      FROM gl.finance_vendor_tds
      WHERE tenant_id = ${ctx.tenantId}::uuid
        AND fy = ${q.fy} AND quarter = ${q.quarter}
      GROUP BY vendor_name, pan, section
      ORDER BY vendor_name
    `));

    // Decrypt PAN in Form 26Q deductee rows
    const deductees = (rows as Record<string, unknown>[]).map((row) => ({
      ...row,
      pan: row.pan ? decryptPii(row.pan as string) : null,
    }));

    return reply.send({
      form: "26Q",
      fy: q.fy,
      quarter: q.quarter,
      deductees,
    });
  });
}
