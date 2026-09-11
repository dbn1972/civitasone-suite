import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, financeErrorHandler } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { decryptPii } from "../../shared/pii-crypto.js";
import { TDS_SECTION_CODES, isValidTdsRateForSection } from "./section-rates.js";

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
      // DOM-013: was `z.string().max(10)` free text -- any junk value was
      // accepted and stored. Now a controlled reference to real Income-tax
      // Act TDS sections (see section-rates.ts).
      section: z.enum(TDS_SECTION_CODES).default("194C"),
      grossAmountMinor: z.number().int().positive(),
      // DOM-013: `tdsRatePct` used to be checked against a flat list of
      // numbers with no link to `section` or the deduction date, so a
      // lapsed COVID-19-era concessional rate (1.5% / 7.5%) could be picked
      // for a section on a current-date deduction. The section+date-aware
      // check below is applied in the object-level .refine() once both
      // fields and `deductionDate` are available.
      tdsRatePct: z.number().default(2),
      tdsAmountMinor: z.number().int().min(0),
      surchargeMinor: z.number().int().min(0).default(0),
      cessMinor: z.number().int().min(0).default(0),
      netPaymentMinor: z.number().int().min(0),
      deductionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
      fy: z.string().regex(/^\d{4}-\d{2}$/),
    }).refine(
      (b) => isValidTdsRateForSection(b.section, b.tdsRatePct, b.deductionDate),
      {
        message: "tdsRatePct is not a valid statutory rate for this section on the given deduction date " +
          "(e.g. a pre-2021-04-01 COVID-19 concessional rate cannot be used for a current-date deduction)",
        path: ["tdsRatePct"],
      }
    ).parse(req.body);

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

  app.setErrorHandler(financeErrorHandler);
}