/**
 * Statutory return filing record (GAP-PAYROLL-RETURNS-01).
 *
 *   POST /v1/payroll/statutory/returns/filings        record that a quarter's e-TDS statement was filed
 *   GET  /v1/payroll/statutory/returns/filings?fy=    the recorded filings for a financial year
 *
 * "Reconciled with TRACES" is not "filed". A quarter is shown as Filed only
 * when a filing is recorded here: the date it was filed and the provisional
 * receipt number (15 digits) NSDL issued. There is no NSDL/TRACES API
 * integration in this system, so the filing itself happens on the TIN-NSDL
 * portal and a payroll operator records it afterwards. A correction statement
 * is recorded as the next revision. The write is CQRS (route validates and
 * pre-checks, the consumer inserts + audits under the unique indexes).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

const RECORD_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "finance_officer"];
const READ_ROLES = [...RECORD_ROLES, "hr_admin"];

/** Today in IST as YYYY-MM-DD. */
function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "must be a real calendar date");

export const filingBody = z.object({
  formType: z.enum(["24Q", "26Q"]).default("24Q"),
  fy: z.string().regex(/^\d{4}-\d{2}$/, "fy must look like 2026-27"),
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
  filedOn: isoDate.refine((v) => v <= todayIst(), "filing date cannot be in the future"),
  receiptNo: z.string().trim().regex(/^\d{15}$/, "provisional receipt number is 15 digits"),
  revision: z.number().int().min(0).max(99).default(0),
  note: z.string().trim().max(500).optional(),
}).strict();
export type FilingInput = z.infer<typeof filingBody>;

export type FilingRow = {
  formType: string; fy: string; quarter: string; filedOn: string; receiptNo: string; revision: number; note: string | null;
};

type DbRow = { form_type: string; fy: string; quarter: string; filed_on: Date | string; receipt_no: string; revision: number; note: string | null };

const dateOnly = (v: Date | string): string => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

export function serializeFiling(r: DbRow): FilingRow {
  return { formType: r.form_type, fy: r.fy, quarter: r.quarter, filedOn: dateOnly(r.filed_on), receiptNo: r.receipt_no, revision: r.revision, note: r.note };
}

/** Latest-revision filing per quarter of one FY (what the return screens show). */
export async function loadLatestFilings(tenantId: string, formType: string, fy: string): Promise<Map<string, FilingRow>> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT DISTINCT ON (quarter) form_type, fy, quarter, filed_on, receipt_no, revision, note
      FROM payroll.statutory_return_filings
     WHERE tenant_id = ${tenantId}::uuid AND form_type = ${formType} AND fy = ${fy}
     ORDER BY quarter, revision DESC
  `))) as unknown as DbRow[];
  return new Map(rows.map((r) => [r.quarter, serializeFiling(r)]));
}

export async function requestFilingRecord(ctx: RequestContext, body: FilingInput) {
  const id = randomUUID();
  await queue.publish(COMMANDS.returnFilingRecord, {
    messageId: id, type: COMMANDS.returnFilingRecord,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function returnFilingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/statutory/returns/filings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = z.object({
      fy: z.string().regex(/^\d{4}-\d{2}$/),
      formType: z.enum(["24Q", "26Q"]).default("24Q"),
    }).parse(req.query ?? {});
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT form_type, fy, quarter, filed_on, receipt_no, revision, note
        FROM payroll.statutory_return_filings
       WHERE tenant_id = ${ctx.tenantId}::uuid AND form_type = ${q.formType} AND fy = ${q.fy}
       ORDER BY quarter, revision DESC
    `))) as unknown as DbRow[];
    return reply.send({ data: rows.map(serializeFiling), meta: { total: rows.length } });
  });

  app.post("/v1/payroll/statutory/returns/filings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RECORD_ROLES);
    const body = filingBody.parse(req.body ?? {});

    const existing = (await scopedRead((tx) => tx.execute(sql`
      SELECT revision, receipt_no FROM payroll.statutory_return_filings
       WHERE tenant_id = ${ctx.tenantId}::uuid
         AND ((form_type = ${body.formType} AND fy = ${body.fy} AND quarter = ${body.quarter} AND revision = ${body.revision})
              OR receipt_no = ${body.receiptNo})
    `))) as unknown as Array<{ revision: number; receipt_no: string }>;
    if (existing.some((e) => e.receipt_no === body.receiptNo)) {
      throw new HttpError(409, "RECEIPT_ALREADY_RECORDED", "this provisional receipt number is already recorded");
    }
    if (existing.length > 0) {
      throw new HttpError(409, "FILING_ALREADY_RECORDED",
        `${body.formType} ${body.fy} ${body.quarter} revision ${body.revision} already has a recorded filing; record a correction statement as the next revision`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await requestFilingRecord(ctx, body));
  });
}
