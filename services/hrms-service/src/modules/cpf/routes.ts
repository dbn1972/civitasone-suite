import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * CPF (Contributory Provident Fund) account + subscription/advance ledger.
 *
 *  POST /v1/hrms/employees/:id/cpf                 open account (CPF-scheme only)
 *  GET  /v1/hrms/employees/:id/cpf                 account + running balances + statement
 *  POST /v1/hrms/employees/:id/cpf/subscription    monthly employee+employer subscription (credit)
 *  POST /v1/hrms/employees/:id/cpf/advance         advance (debit, recoverable)
 *  POST /v1/hrms/employees/:id/cpf/withdrawal      withdrawal (debit, non-recoverable)
 *  POST /v1/hrms/employees/:id/cpf/refund          refund of advance (credit, employee leg)
 *  POST /v1/hrms/employees/:id/cpf/interest        interest accrual on total corpus (credit)
 *
 * Money in paise (bigint); employee + employer running balances on every row.
 * Monthly subscription is idempotent per (account, period).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
import type { CpfAccountRow } from "./schema.js";

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

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "23505";
}

async function mustEmployee(tenantId: string, id: string) {
  const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId))).limit(1));
  const emp = rows[0];
  if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
  return emp;
}

async function mustAccount(tenantId: string, employeeId: string): Promise<CpfAccountRow> {
  const acct = await repo.findAccountByEmployee(tenantId, employeeId);
  if (!acct) throw new HttpError(404, "NO_CPF_ACCOUNT", "employee has no CPF account");
  return acct;
}

export async function cpfRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/employees/:id/cpf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      cpfNumber: z.string().min(1).max(32),
      openingEmpMinor: z.coerce.number().int().min(0).default(0),
      openingErMinor: z.coerce.number().int().min(0).default(0),
      monthlySubscriptionMinor: z.coerce.number().int().min(0).default(0),
      interestRatePct: z.coerce.number().min(0).max(20).default(7.10),
    }).parse(req.body);
    const emp = await mustEmployee(ctx.tenantId, id);
    if (emp.pensionScheme !== "CPF") {
      throw new HttpError(409, "NOT_CPF_SCHEME", `employee is on ${emp.pensionScheme}, not CPF`);
    }
    if (await repo.findAccountByEmployee(ctx.tenantId, id)) {
      throw new HttpError(409, "CPF_EXISTS", "CPF account already exists");
    }
    const acctId = randomUUID();
    const openEmp = BigInt(body.openingEmpMinor);
    const openEr = BigInt(body.openingErMinor);
    try {
      await publishF3Write(ctx, "cpf_routes__0", acctId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      // A concurrent open (same employee, or a duplicate government CPF number) as any races
      // past the pre-checks and surfaces as a 23505; map it to a clean 409 like NPS.
      if (isUniqueViolation(err)) {
        const constraint = (err as { constraint_name?: string }).constraint_name ?? "";
        if (constraint === "hrms_cpf_accounts_cpf_number_uq") {
          throw new HttpError(409, "CPF_NUMBER_TAKEN", "CPF number already allocated");
        }
        throw new HttpError(409, "CPF_EXISTS", "CPF account already exists");
      }
      throw err;
    }
    return reply.code(201).send(jsonSafe({ id: acctId, employeeId: id, cpfNumber: body.cpfNumber }));
  });

  app.get("/v1/hrms/employees/:id/cpf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const acct = await mustAccount(ctx.tenantId, id);
    const [bal, ledger] = await Promise.all([
      repo.currentBalance(ctx.tenantId, acct),
      repo.listLedger(ctx.tenantId, acct.id),
    ]);
    return reply.send(jsonSafe({
      account: acct, runningBalanceMinor: bal.total,
      employeeBalanceMinor: bal.emp, employerBalanceMinor: bal.er, ledger,
    }));
  });

  // monthly subscription: credits BOTH legs, idempotent per period.
  app.post("/v1/hrms/employees/:id/cpf/subscription", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM"),
      empAmountMinor: z.coerce.number().int().min(0).default(0),
      erAmountMinor: z.coerce.number().int().min(0).default(0),
      narrative: z.string().max(500).optional(),
    }).refine((b) => b.empAmountMinor > 0 || b.erAmountMinor > 0, { message: "at least one of employee/employer amount required" })
      .parse(req.body);
    const acct = await mustAccount(ctx.tenantId, id);
    const empAmt = BigInt(body.empAmountMinor);
    const erAmt = BigInt(body.erAmountMinor);
    const ledgerId = randomUUID();
    try {
      const { next } = await publishF3Write(ctx, "cpf_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
      return reply.code(201).send(jsonSafe({
        ledgerId, period: body.period, empAmountMinor: empAmt, erAmountMinor: erAmt,
        balanceMinor: next.total, employeeBalanceMinor: next.emp, employerBalanceMinor: next.er,
      })) as any;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError(409, "PERIOD_ALREADY_POSTED", `CPF subscription for ${body.period} already posted`);
      }
      throw err;
    }
  });

  // debit ops: advance / withdrawal — CQRS publish (consumer draws employer leg first).
  async function debit(ctx: { tenantId: string; actorId: string; correlationId: string }, reqBody: unknown, params: unknown,
    entryType: "advance" | "withdrawal") {
    const { id } = idParam.parse(params);
    const body = z.object({
      amountMinor: z.coerce.number().int().positive(),
      narrative: z.string().max(500).optional(),
      effectiveDate: z.string().optional(),
    }).parse(reqBody);
    await mustAccount(ctx.tenantId, id);
    return publishF3Write(ctx as any, "cpf_routes__debit", id, {
      body: { ...body, entryType },
      params: params as Record<string, unknown>,
      query: {},
    });
  }

  app.post("/v1/hrms/employees/:id/cpf/advance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    return reply.code(202).send(await debit(ctx, req.body, req.params, "advance"));
  });

  app.post("/v1/hrms/employees/:id/cpf/withdrawal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    return reply.code(202).send(await debit(ctx, req.body, req.params, "withdrawal"));
  });

  // refund of an advance: credit to the employee leg.
  app.post("/v1/hrms/employees/:id/cpf/refund", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      amountMinor: z.coerce.number().int().positive(),
      narrative: z.string().max(500).optional(),
    }).parse(req.body);
    await mustAccount(ctx.tenantId, id);
    return reply.code(202).send(await publishF3Write(ctx, "cpf_routes__2", id, {
      body, params: req.params as Record<string, unknown>, query: {},
    })) as any;
  });

  // interest accrual on the TOTAL corpus, credited to the employee leg.
  app.post("/v1/hrms/employees/:id/cpf/interest", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      months: z.coerce.number().int().min(1).max(12).default(12),
      ratePctOverride: z.coerce.number().min(0).max(20).optional(),
    }).parse(req.body);
    await mustAccount(ctx.tenantId, id);
    return reply.code(202).send(await publishF3Write(ctx, "cpf_routes__3", id, {
      body, params: req.params as Record<string, unknown>, query: {},
    })) as any;
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
