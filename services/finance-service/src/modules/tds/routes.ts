import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { decryptPii } from "../../shared/pii-crypto.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

export async function vendorTdsRoutes(app: FastifyInstance): Promise<void> {
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

    const decryptedRows = (rows as Record<string, unknown>[]).map((row) => ({
      ...row,
      pan: row.pan ? decryptPii(row.pan as string) : null,
    }));

    return reply.send({ data: decryptedRows });
  });

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
      tdsRatePct: z.number().refine(
        r => ([0, 1, 1.5, 2, 5, 7.5, 10, 20, 30] as readonly number[]).includes(r),
        { message: "tdsRatePct must be a statutory rate: 0, 1, 1.5, 2, 5, 7.5, 10, 20, 30%" }
      ).default(2),
      tdsAmountMinor: z.number().int().min(0),
      surchargeMinor: z.number().int().min(0).default(0),
      cessMinor: z.number().int().min(0).default(0),
      netPaymentMinor: z.number().int().min(0),
      deductionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
      fy: z.string().regex(/^\d{4}-\d{2}$/),
    }).parse(req.body);

    const id = randomUUID();
    await queue.publish(COMMANDS.tdsDeductionRecord, {
      messageId: id, type: COMMANDS.tdsDeductionRecord,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

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

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}