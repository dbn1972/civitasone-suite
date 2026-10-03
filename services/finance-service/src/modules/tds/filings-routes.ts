import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { fetchUserSummaries, actorName } from "../../shared/identity-client.js";
import {
  TDS_QUARTERS, DEFAULT_TDS_FORM, TdsFilingError, defaultDueDate, filingStatus,
  assertValidAckNo, assertValidFilingDate, istDate, type TdsQuarter,
} from "./filings-domain.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];
const FY = z.string().regex(/^\d{4}-\d{2}$/);

function asHttp(err: unknown): never {
  if (err instanceof TdsFilingError) throw new HttpError(400, err.code, err.message);
  throw err;
}

type FilingRow = { quarter: string; due_date: string; ack_no: string; filed_on: string; filed_by: string; filed_at: string };
type CountRow = { quarter: string; deduction_count: number; total_tds_minor: string; undeposited_count: number };

/**
 * Quarterly TDS return filing register. GET lists the four quarters of an FY with
 * the recorded filing (if any) and the deduction totals; POST records a filing.
 * The route publishes a command; the consumer writes in a transaction with an
 * audit event. Recording is a factual entry of an acknowledgement obtained from
 * the external e-filing portal -- it is not an approval decision, so it is not
 * maker-checker gated (see PR VERIFY notes).
 */
export async function tdsReturnFilingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/tds-returns", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({ fy: FY }).parse(req.query);

    const [filings, counts, names] = await Promise.all([
      scopedRead((tx) => tx.execute(sql`
        SELECT quarter, due_date::text AS due_date, ack_no, filed_on::text AS filed_on,
               filed_by::text AS filed_by, filed_at::text AS filed_at
        FROM gl.finance_tds_return_filings
        WHERE tenant_id = ${ctx.tenantId}::uuid AND fy = ${q.fy} AND form_type = ${DEFAULT_TDS_FORM}
      `)),
      scopedRead((tx) => tx.execute(sql`
        SELECT quarter, COUNT(*)::int AS deduction_count,
               COALESCE(SUM(tds_amount_minor), 0)::text AS total_tds_minor,
               COUNT(*) FILTER (WHERE status = 'deducted')::int AS undeposited_count
        FROM gl.finance_vendor_tds
        WHERE tenant_id = ${ctx.tenantId}::uuid AND fy = ${q.fy}
        GROUP BY quarter
      `)),
      fetchUserSummaries(ctx.tenantId),
    ]);
    const filingByQ = new Map((filings as unknown as FilingRow[]).map((f) => [f.quarter, f]));
    const countByQ = new Map((counts as unknown as CountRow[]).map((c) => [c.quarter, c]));
    const today = istDate();

    const data = TDS_QUARTERS.map((quarter) => {
      const f = filingByQ.get(quarter);
      const c = countByQ.get(quarter);
      const dueDate = f?.due_date ?? defaultDueDate(q.fy, quarter);
      return {
        fy: q.fy,
        quarter,
        formType: DEFAULT_TDS_FORM,
        dueDate,
        status: filingStatus(Boolean(f), dueDate, today),
        ackNo: f?.ack_no ?? null,
        filedOn: f?.filed_on ?? null,
        filedAt: f?.filed_at ?? null,
        filedByName: f ? actorName(names, f.filed_by) : null,
        deductionCount: c?.deduction_count ?? 0,
        totalTdsMinor: c?.total_tds_minor ?? "0",
        undepositedCount: c?.undeposited_count ?? 0,
      };
    });
    return reply.send({ data });
  });

  app.post("/v1/finance/tds-returns/:fy/:quarter/file", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const params = z.object({ fy: FY, quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]) }).parse(req.params);
    const body = z.object({
      ackNo: z.string().trim().min(1).max(32),
      filedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(req.body);
    const quarter = params.quarter as TdsQuarter;
    try {
      assertValidAckNo(body.ackNo);
      assertValidFilingDate(params.fy, quarter, body.filedOn, istDate());
    } catch (err) {
      asHttp(err);
    }
    // Friendly pre-check; the consumer's INSERT ... ON CONFLICT DO NOTHING is the race-safe guard.
    const existing = await scopedRead((tx) => tx.execute(sql`
      SELECT 1 FROM gl.finance_tds_return_filings
      WHERE tenant_id = ${ctx.tenantId}::uuid AND fy = ${params.fy} AND quarter = ${quarter} AND form_type = ${DEFAULT_TDS_FORM}
      LIMIT 1
    `));
    if ((existing as unknown as unknown[]).length > 0) {
      throw new HttpError(409, "ALREADY_FILED", "this quarter's return is already recorded as filed");
    }
    const id = randomUUID();
    await queue.publish(COMMANDS.tdsReturnFile, {
      messageId: randomUUID(), type: COMMANDS.tdsReturnFile,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id, tenantId: ctx.tenantId, fy: params.fy, quarter, formType: DEFAULT_TDS_FORM,
        ackNo: body.ackNo, filedOn: body.filedOn, dueDate: defaultDueDate(params.fy, quarter),
      },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.setErrorHandler(financeErrorHandler);
}
