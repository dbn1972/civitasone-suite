/**
 * Debt and guarantee registers (fp-finance-01): create + EMI schedule + instalment payment.
 * Routes validate and publish commands; register-consumer.ts performs the writes.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { financeDebt, financeDebtEmi } from "./schema.js";
import { assertPaidInOrder, assertPaidOnValid, assertPeriodPostable, buildEmiSchedule, DebtDomainError, istDate } from "./debt-domain.js";
import { findPeriodClose } from "../period-close/repo.js";
import { requireDebtHeads } from "../approvals/repo.js";
import { DomainError } from "../approvals/domain.js";
import { financeJournals } from "../gl/schema.js";
import { createDebtBody, createGuaranteeBody, emiParams, payEmiBody } from "./register-validators.js";
import { idParam } from "./validators.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];

/** A debt posting dated in a closed period would never post: 409 PERIOD_CLOSED. */
async function periodOpenOr409(tenantId: string, date: string): Promise<void> {
  const row = await findPeriodClose(tenantId, date.slice(0, 7));
  try {
    assertPeriodPostable(row?.status ?? "open", date);
  } catch (err) {
    if (err instanceof DebtDomainError) throw new HttpError(409, err.code, err.message);
    throw err;
  }
}

/** GL head problems are a 409: the debt register cannot post until finance configures them. */
async function glHeadsOr409(tenantId: string, bankHeadId?: string): Promise<void> {
  try {
    await requireDebtHeads(tenantId, { bankHeadId: bankHeadId ?? null });
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(409, err.code, err.message);
    throw err;
  }
}

export async function treasuryRegisterRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/guarantees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createGuaranteeBody.parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.guaranteeCreate, {
      messageId: id, type: COMMANDS.guaranteeCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      // paise cross the queue as a base-10 string (JSON has no bigint)
      payload: { id, tenantId: ctx.tenantId, ...body, amountMinor: body.amountMinor.toString() },
    });
    return reply.code(202).send({ id, status: "accepted" });
  });

  app.post("/v1/finance/debt", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createDebtBody.parse(req.body);
    // Validate the terms synchronously by building the schedule once; the consumer builds it again to persist.
    try {
      buildEmiSchedule({ ...body, principalMinor: body.principalMinor });
    } catch (err) {
      if (err instanceof DebtDomainError) throw new HttpError(400, err.code, err.message);
      throw err;
    }
    await glHeadsOr409(ctx.tenantId);
    await periodOpenOr409(ctx.tenantId, istDate());
    const id = randomUUID();
    await queue.publish(COMMANDS.debtCreate, {
      messageId: id, type: COMMANDS.debtCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body, principalMinor: body.principalMinor.toString() },
    });
    return reply.code(202).send({ id, status: "accepted" });
  });

  app.get("/v1/finance/debt/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const found = await scopedRead(async (tx) => {
      const [debt] = await tx.select().from(financeDebt)
        .where(and(eq(financeDebt.tenantId, ctx.tenantId), eq(financeDebt.id, id))).limit(1);
      if (!debt) return null;
      const emi = await tx.select().from(financeDebtEmi)
        .where(and(eq(financeDebtEmi.tenantId, ctx.tenantId), eq(financeDebtEmi.debtId, id)))
        .orderBy(asc(financeDebtEmi.installmentNo));
      const jIds = [debt.receiptJournalId, ...emi.map((e) => e.journalId)].filter((x): x is string => !!x);
      const posted = jIds.length === 0 ? [] : await tx.select({ id: financeJournals.id }).from(financeJournals)
        .where(and(eq(financeJournals.tenantId, ctx.tenantId), inArray(financeJournals.id, jIds)));
      return { debt, emi, posted: new Set(posted.map((p) => p.id)) };
    });
    if (!found) throw new HttpError(404, "NOT_FOUND", "debt instrument not found");
    const { debt, emi, posted } = found;
    const gl = (jid: string | null) => (jid ? (posted.has(jid) ? "posted" : "pending") : null);
    return reply.send({
      id: debt.id, instrument: debt.instrument, source: debt.source, lender: debt.lender,
      principalMinor: debt.amountMinor.toString(), currency: debt.currency,
      interestRateBps: debt.interestRateBps, tenureMonths: debt.tenureMonths, firstEmiDate: debt.firstEmiDate,
      maturity: debt.maturity, status: debt.status,
      outstandingMinor: debt.outstandingMinor == null ? null : debt.outstandingMinor.toString(),
      receiptGlStatus: gl(debt.receiptJournalId),
      schedule: emi.map((e) => ({
        installmentNo: e.installmentNo, dueDate: e.dueDate,
        principalMinor: e.principalMinor.toString(), interestMinor: e.interestMinor.toString(), totalMinor: e.totalMinor.toString(),
        status: e.status, paidOn: e.paidOn, paymentRef: e.paymentRef, glStatus: gl(e.journalId),
      })),
    });
  });

  app.post("/v1/finance/debt/:id/emi/:no/pay", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id, no } = emiParams.parse(req.params);
    const body = payEmiBody.parse(req.body ?? {});
    const found = await scopedRead(async (tx) => {
      const [debt] = await tx.select({ firstEmiDate: financeDebt.firstEmiDate }).from(financeDebt)
        .where(and(eq(financeDebt.tenantId, ctx.tenantId), eq(financeDebt.id, id))).limit(1);
      const emi = await tx.select({ no: financeDebtEmi.installmentNo, status: financeDebtEmi.status }).from(financeDebtEmi)
        .where(and(eq(financeDebtEmi.tenantId, ctx.tenantId), eq(financeDebtEmi.debtId, id))).orderBy(asc(financeDebtEmi.installmentNo));
      return { debt, emi };
    });
    const row = found.emi.find((e) => e.no === no);
    if (!found.debt || !row) throw new HttpError(404, "NOT_FOUND", "instalment not found");
    if (row.status === "paid") throw new HttpError(409, "EMI_ALREADY_PAID", "this instalment is already recorded as paid");
    try {
      assertPaidInOrder(no, found.emi.find((e) => e.status === "due")?.no ?? null);
      if (body.paidOn) assertPaidOnValid(body.paidOn, found.debt.firstEmiDate);
    } catch (err) {
      if (err instanceof DebtDomainError) throw new HttpError(err.code === "EMI_OUT_OF_ORDER" ? 409 : 400, err.code, err.message, err.code === "EMI_OUT_OF_ORDER" ? undefined : [{ field: "paidOn", message: err.message }]);
      throw err;
    }
    await glHeadsOr409(ctx.tenantId, body.bankHeadId);
    await periodOpenOr409(ctx.tenantId, body.paidOn ?? istDate());
    await queue.publish(COMMANDS.debtEmiPay, {
      // Fresh id per attempt: a deterministic id would drop a legitimate retry after a failure.
      messageId: randomUUID(), type: COMMANDS.debtEmiPay,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { debtId: id, installmentNo: no, tenantId: ctx.tenantId, paidOn: body.paidOn ?? null, paymentRef: body.paymentRef ?? null, bankHeadId: body.bankHeadId ?? null },
    });
    return reply.code(202).send({ id, installmentNo: no, status: "accepted" });
  });

  app.setErrorHandler(financeErrorHandler);
}
