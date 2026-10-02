/**
 * Disbursement transfer ledger API -- backs the "Employee Bank Transfers"
 * card on /hr/payroll/disbursement.
 *
 *   GET  /v1/payroll/disbursement/transfers                  list (paginated, run/status filters)
 *   POST /v1/payroll/disbursement/transfers/:id/retry        new pending attempt for a failed/returned row
 *   POST /v1/payroll/disbursement/transfers/:id/reconcile    manual outcome for a non-NACH 'sent' row
 *
 * Mutations follow this service's CQRS boundary: the route validates and
 * answers 404/409 synchronously, then publishes a command; consumer.ts does
 * the write + audit in one transaction under a row lock (202 Accepted).
 *
 * There is no bank API here: a retry only queues a 'pending' attempt that the
 * NEXT bank-file generation for the run picks up (bank-transfer/routes.ts ->
 * ledger.ts recordBankFileTransfers). CSV/NEFT files have no machine-readable
 * credit feed, so their rows stay 'sent' until a payroll admin reconciles them
 * here (audited, with a reason). NACH rows are settled by the return file.
 *
 * The full account number is never stored or returned: rows carry only the
 * last 4, surfaced as `accountNumberMasked` ("XXXX1234").
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { payrollRuns } from "../payroll/schema.js";
import { disbursementTransfers, TRANSFER_STATUSES, type DisbursementTransferRow } from "./schema.js";
import { requestTransferReconcile, requestTransferRetry, retryRequestHash, retryTransferId } from "./commands.js";

/** Mirrors the page gate (PAYROLL_ADMIN_ROLES in apps/web roleGuard.ts) and bank-file's PAYROLL_ROLES. */
const PAYROLL_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];
/** Manual reconcile records a payment outcome without bank evidence: admin only. */
const RECONCILE_ROLES = ["payroll_admin", "super_admin"];

const listQuerySchema = z.object({
  runId: z.string().uuid().optional(),
  status: z.enum(TRANSFER_STATUSES).optional(),
  /** Default: only the current attempt per payment (rows not yet superseded by a retry). */
  includeSuperseded: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParamSchema = z.object({ id: z.string().uuid() });

const reasonSchema = z.string().trim().min(10, "reason must be at least 10 characters").max(500);

const retryBodySchema = z.object({ reason: reasonSchema }).strict();

const idempotencyKeySchema = z.string().trim().min(8).max(128);

const reconcileBodySchema = z.object({
  outcome: z.enum(["success", "failed", "returned"]),
  reason: reasonSchema,
  reasonCode: z.string().trim().min(1).max(8).optional(),
}).strict();

export type TransferResponse = {
  id: string;
  runId: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  accountNumberMasked: string | null;
  ifsc: string;
  /** Authoritative amount, integer paise as a string (bigint-safe). */
  amountPaise: string;
  /** Display convenience, rupees -- derived from amountPaise. */
  amountRupees: number;
  status: DisbursementTransferRow["status"];
  fileFormat: string | null;
  fileReference: string | null;
  nachBatchId: string | null;
  failureReason: string | null;
  reasonCode: string | null;
  attemptNo: number;
  parentTransferId: string | null;
  sentAt: string | null;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function iso(v: Date | string | null): string | null {
  if (v == null) return null;
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

export function serializeTransfer(r: DisbursementTransferRow): TransferResponse {
  const isFailure = r.status === "failed" || r.status === "returned";
  const failureReason = isFailure
    ? (r.reasonText ?? null) ?? (r.reasonCode ? `Reason code ${r.reasonCode}` : null)
    : null;
  return {
    id: r.id,
    runId: r.runId,
    employeeId: r.employeeId,
    employeeNo: r.employeeNo,
    employeeName: r.beneficiaryName,
    accountNumberMasked: r.accountLast4 ? `XXXX${r.accountLast4}` : null,
    ifsc: r.ifsc,
    amountPaise: r.amountMinor.toString(),
    amountRupees: Number(r.amountMinor) / 100,
    status: r.status,
    fileFormat: r.fileFormat,
    fileReference: r.fileReference,
    nachBatchId: r.fileFormat === "nach" ? r.fileReference : null,
    failureReason,
    reasonCode: r.reasonCode,
    attemptNo: r.attemptNo,
    parentTransferId: r.parentTransferId,
    sentAt: iso(r.sentAt),
    settledAt: iso(r.settledAt),
    createdAt: iso(r.createdAt) as string,
    updatedAt: iso(r.updatedAt) as string,
  };
}

export async function disbursementTransferRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/payroll/disbursement/transfers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const q = listQuerySchema.parse(req.query ?? {});
    const t = disbursementTransfers;

    const conds: SQL[] = [eq(t.tenantId, ctx.tenantId)];
    if (q.runId) conds.push(eq(t.runId, q.runId));
    if (q.status) conds.push(eq(t.status, q.status));
    if (!q.includeSuperseded) {
      conds.push(sql`NOT EXISTS (SELECT 1 FROM payroll.disbursement_transfers c
                                  WHERE c.parent_transfer_id = ${t.id})`);
    }
    const where = and(...conds);

    const [rows, countRows] = await scopedRead(async (tx) => Promise.all([
      tx.select().from(t).where(where).orderBy(desc(t.createdAt), desc(t.id)).limit(q.limit).offset(q.offset),
      tx.select({ n: sql<string>`count(*)::text` }).from(t).where(where),
    ]));
    return reply.send({
      data: rows.map(serializeTransfer),
      meta: { limit: q.limit, offset: q.offset, total: Number(countRows[0]?.n ?? "0") },
    });
  });

  /**
   * Queue a retry of a failed/returned transfer. Everything that can be
   * decided now is decided now (404 / 409 / idempotent replay); the write
   * itself happens in consumer.ts under a row lock (CQRS boundary). 202 with
   * the new attempt's id (a pure function of tenant + x-idempotency-key);
   * 200 with the existing row when the same key + payload is replayed after
   * the attempt was recorded.
   */
  app.post("/v1/payroll/disbursement/transfers/:id/retry", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PAYROLL_ROLES);
    const { id } = idParamSchema.parse(req.params);
    const { reason } = retryBodySchema.parse(req.body ?? {});
    const keyParse = idempotencyKeySchema.safeParse(req.headers["x-idempotency-key"]);
    if (!keyParse.success) {
      throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "x-idempotency-key header (8-128 chars) is required");
    }
    const idempotencyKey = keyParse.data;
    const requestHash = retryRequestHash(id, reason);
    const t = disbursementTransfers;

    const pre = await scopedRead(async (tx) => {
      const parent = (await tx.select().from(t)
        .where(and(eq(t.id, id), eq(t.tenantId, ctx.tenantId))).limit(1))[0];
      if (!parent) return null;
      const prior = (await tx.select().from(t)
        .where(and(eq(t.tenantId, ctx.tenantId), eq(t.idempotencyKey, idempotencyKey))).limit(1))[0];
      const child = (await tx.select({ id: t.id }).from(t)
        .where(and(eq(t.tenantId, ctx.tenantId), eq(t.parentTransferId, id))).limit(1))[0];
      const run = (await tx.select({ status: payrollRuns.status }).from(payrollRuns)
        .where(and(eq(payrollRuns.id, parent.runId), eq(payrollRuns.tenantId, ctx.tenantId))).limit(1))[0];
      return { parent, prior, child, runStatus: run?.status };
    });
    if (!pre) throw new HttpError(404, "NOT_FOUND", "transfer not found");

    if (pre.prior) {
      if (pre.prior.parentTransferId === id && pre.prior.requestHash === requestHash) {
        return reply.status(200).send({ data: serializeTransfer(pre.prior) });
      }
      throw new HttpError(409, "IDEMPOTENCY_KEY_REUSED",
        "this x-idempotency-key was already used for a different retry request");
    }
    if (pre.parent.status !== "failed" && pre.parent.status !== "returned") {
      throw new HttpError(409, "INVALID_STATE",
        `only a failed or returned transfer can be retried (this one is ${pre.parent.status})`);
    }
    if (pre.child) {
      throw new HttpError(409, "ALREADY_RETRIED", "this transfer already has a retry attempt");
    }
    // The retry is paid by the NEXT bank file for the run, which can only be
    // generated for an approved or disbursed run.
    if (pre.runStatus !== "approved" && pre.runStatus !== "disbursed") {
      throw new HttpError(409, "RUN_NOT_PAYABLE",
        "the payroll run is not approved or disbursed, so no bank file can carry this retry");
    }

    const retryId = retryTransferId(ctx.tenantId, id, idempotencyKey);
    await requestTransferRetry(ctx, { transferId: id, retryId, reason, idempotencyKey, requestHash });
    return reply.status(202).send({
      data: { id: retryId, status: "pending", parentTransferId: id, correlationId: ctx.correlationId },
    });
  });

  /**
   * Manual reconcile of a CSV/NEFT transfer: there is no machine-readable
   * credit feed for those files, so their rows stay 'sent' until a payroll
   * admin records the outcome from the bank statement (audited, with a
   * reason). NACH rows are settled only by the NACH return file.
   */
  app.post("/v1/payroll/disbursement/transfers/:id/reconcile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RECONCILE_ROLES);
    const { id } = idParamSchema.parse(req.params);
    const body = reconcileBodySchema.parse(req.body ?? {});
    const t = disbursementTransfers;

    const row = (await scopedRead((tx) => tx.select().from(t)
      .where(and(eq(t.id, id), eq(t.tenantId, ctx.tenantId))).limit(1)))[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "transfer not found");
    if (row.fileFormat === "nach") {
      throw new HttpError(409, "NACH_USES_RETURN_FILE",
        "NACH transfers are settled by uploading the bank's NACH return file, not manually");
    }
    if (row.status !== "sent") {
      throw new HttpError(409, "INVALID_STATE",
        `only a sent transfer can be reconciled (this one is ${row.status})`);
    }

    await requestTransferReconcile(ctx, {
      transferId: id,
      outcome: body.outcome,
      reason: body.reason,
      reasonCode: body.reasonCode ?? null,
    });
    return reply.status(202).send({
      data: { id, status: "accepted", outcome: body.outcome, correlationId: ctx.correlationId },
    });
  });
}
