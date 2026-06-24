/**
 * GPF (General Provident Fund) account + advances/withdrawals ledger.
 *
 *  POST /v1/hrms/employees/:id/gpf            open account (GPF-scheme only)
 *  GET  /v1/hrms/employees/:id/gpf            account + running balance + ledger
 *  POST /v1/hrms/employees/:id/gpf/subscription   monthly subscription (credit)
 *  POST /v1/hrms/employees/:id/gpf/advance        advance/withdrawal (debit)
 *  POST /v1/hrms/employees/:id/gpf/refund         refund of advance (credit)
 *  POST /v1/hrms/employees/:id/gpf/interest       accrue interest on balance (credit)
 *
 * Money in paise (bigint). Running balance carried on every ledger row.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
import type { GpfAccountRow } from "./schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin", "finance_officer", "payroll_admin"];
const idParam = z.object({ id: z.string().uuid() });

function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = jsonSafe(val);
    return out;
  }
  return v;
}

async function mustEmployee(tenantId: string, id: string) {
  const rows = await db.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId))).limit(1);
  const emp = rows[0];
  if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
  return emp;
}

async function mustAccount(tenantId: string, employeeId: string): Promise<GpfAccountRow> {
  const acct = await repo.findAccountByEmployee(tenantId, employeeId);
  if (!acct) throw new HttpError(404, "NO_GPF_ACCOUNT", "employee has no GPF account");
  return acct;
}

export async function gpfRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/employees/:id/gpf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      gpfNumber: z.string().min(1).max(32),
      openingBalanceMinor: z.coerce.number().int().min(0).default(0),
      monthlySubscriptionMinor: z.coerce.number().int().min(0).default(0),
      interestRatePct: z.coerce.number().min(0).max(20).default(7.10),
    }).parse(req.body);
    const emp = await mustEmployee(ctx.tenantId, id);
    if (emp.pensionScheme !== "GPF") {
      throw new HttpError(409, "NOT_GPF_SCHEME", `employee is on ${emp.pensionScheme}, not GPF`);
    }
    const existing = await repo.findAccountByEmployee(ctx.tenantId, id);
    if (existing) throw new HttpError(409, "GPF_EXISTS", "GPF account already exists");

    const acctId = randomUUID();
    const opening = BigInt(body.openingBalanceMinor);
    await db.transaction(async (tx) => {
      await repo.insertAccount(tx, {
        id: acctId, tenantId: ctx.tenantId, employeeId: id, gpfNumber: body.gpfNumber,
        openingBalanceMinor: opening,
        monthlySubscriptionMinor: BigInt(body.monthlySubscriptionMinor),
        interestRatePct: String(body.interestRatePct),
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      if (opening > 0n) {
        await repo.insertLedger(tx, {
          id: randomUUID(), tenantId: ctx.tenantId, accountId: acctId, employeeId: id,
          entryType: "opening", amountMinor: opening, deltaMinor: opening, balanceMinor: opening,
          narrative: "opening balance", createdBy: ctx.actorId,
        });
      }
    });
    return reply.code(201).send(jsonSafe({ id: acctId, employeeId: id, gpfNumber: body.gpfNumber, openingBalanceMinor: opening }));
  });

  app.get("/v1/hrms/employees/:id/gpf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const acct = await mustAccount(ctx.tenantId, id);
    const [balance, ledger] = await Promise.all([
      repo.currentBalance(ctx.tenantId, acct),
      repo.listLedger(ctx.tenantId, acct.id),
    ]);
    return reply.send(jsonSafe({ account: acct, runningBalanceMinor: balance, ledger }));
  });

  // generic credit/debit posting
  async function post(
    req: FastifyRequest,
    reply: FastifyReply,
    entryType: "subscription" | "advance" | "withdrawal" | "refund",
    sign: 1 | -1,
  ) {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      amountMinor: z.coerce.number().int().positive(),
      narrative: z.string().max(500).optional(),
      effectiveDate: z.string().optional(),
    }).parse(req.body);
    const acct = await mustAccount(ctx.tenantId, id);
    const amount = BigInt(body.amountMinor);
    const delta = sign === 1 ? amount : -amount;
    const ledgerId = randomUUID();
    // Lock the account, read the balance, guard and insert — all in one tx so
    // two concurrent debits cannot both pass the INSUFFICIENT_BALANCE check. (C1)
    const { prev, next } = await db.transaction(async (tx) => {
      const prevBal = await repo.lockedBalance(tx, ctx.tenantId, acct);
      const nextBal = prevBal + delta;
      if (nextBal < 0n) throw new HttpError(409, "INSUFFICIENT_BALANCE", "debit exceeds available GPF balance");
      await repo.insertLedger(tx, {
        id: ledgerId, tenantId: ctx.tenantId, accountId: acct.id, employeeId: id,
        entryType, amountMinor: amount, deltaMinor: delta, balanceMinor: nextBal,
        ...(body.narrative !== undefined ? { narrative: body.narrative } : {}),
        ...(body.effectiveDate !== undefined ? { effectiveDate: body.effectiveDate } : {}),
        createdBy: ctx.actorId,
      });
      // L4: bump the account optimistic-lock version on every ledger mutation.
      await repo.bumpAccountVersion(tx, ctx.tenantId, acct.id, ctx.actorId, acct.version);
      return { prev: prevBal, next: nextBal };
    });
    return reply.code(201).send(jsonSafe({
      ledgerId, entryType, amountMinor: amount, previousBalanceMinor: prev, balanceMinor: next,
    }));
  }

  app.post("/v1/hrms/employees/:id/gpf/subscription", (req, reply) => post(req, reply, "subscription", 1));
  app.post("/v1/hrms/employees/:id/gpf/advance", (req, reply) => post(req, reply, "advance", -1));
  app.post("/v1/hrms/employees/:id/gpf/withdrawal", (req, reply) => post(req, reply, "withdrawal", -1));
  app.post("/v1/hrms/employees/:id/gpf/refund", (req, reply) => post(req, reply, "refund", 1));

  // interest accrual: credit = balance * ratePct/100 * (months/12)
  app.post("/v1/hrms/employees/:id/gpf/interest", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      months: z.coerce.number().int().min(1).max(12).default(12),
      ratePctOverride: z.coerce.number().min(0).max(20).optional(),
    }).parse(req.body);
    const acct = await mustAccount(ctx.tenantId, id);
    const ratePct = body.ratePctOverride ?? Number(acct.interestRatePct);
    const ledgerId = randomUUID();
    // Read the locked balance inside the tx so interest accrues on the true,
    // serialised balance (not a stale pre-tx read). (C1)
    const { prev, interest, next } = await db.transaction(async (tx) => {
      const prevBal = await repo.lockedBalance(tx, ctx.tenantId, acct);
      // paise * rate% * months/12, rounded to nearest paise
      const interestMinor = BigInt(Math.round(Number(prevBal) * (ratePct / 100) * (body.months / 12)));
      const nextBal = prevBal + interestMinor;
      await repo.insertLedger(tx, {
        id: ledgerId, tenantId: ctx.tenantId, accountId: acct.id, employeeId: id,
        entryType: "interest", amountMinor: interestMinor, deltaMinor: interestMinor, balanceMinor: nextBal,
        narrative: `interest @ ${ratePct}% for ${body.months} month(s)`, createdBy: ctx.actorId,
      });
      // L4: bump the account optimistic-lock version on interest accrual too.
      await repo.bumpAccountVersion(tx, ctx.tenantId, acct.id, ctx.actorId, acct.version);
      return { prev: prevBal, interest: interestMinor, next: nextBal };
    });
    return reply.code(201).send(jsonSafe({
      ledgerId, ratePct, months: body.months, interestMinor: interest,
      previousBalanceMinor: prev, balanceMinor: next,
    }));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
