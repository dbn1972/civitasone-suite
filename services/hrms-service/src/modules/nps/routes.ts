import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * NPS (National Pension System) individual PRAN account + contribution ledger.
 *
 *  POST /v1/hrms/employees/:id/nps                enroll / allocate PRAN (NPS-scheme only)
 *  GET  /v1/hrms/employees/:id/nps                account + running balances + statement
 *  POST /v1/hrms/employees/:id/nps/contribution   monthly employee+employer contribution (credit)
 *  POST /v1/hrms/employees/:id/nps/withdrawal     partial/exit withdrawal (debit)
 *
 * The contribution endpoint is the sink for the payroll monthly NPS snapshot
 * (emp 10% / er 14%): posting one row per (account, period) is idempotent, so
 * re-running a payroll period never double-counts. Money in paise (bigint);
 * employee + employer running balances carried on every ledger row.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
import type { NpsAccountRow } from "./schema.js";

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
  const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId))).limit(1));
  const emp = rows[0];
  if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
  return emp;
}

async function mustAccount(tenantId: string, employeeId: string): Promise<NpsAccountRow> {
  const acct = await repo.findAccountByEmployee(tenantId, employeeId);
  if (!acct) throw new HttpError(404, "NO_NPS_ACCOUNT", "employee has no NPS account");
  return acct;
}

export async function npsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/employees/:id/nps", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      pran: z.string().min(8).max(20),
      tier: z.enum(["I", "II"]).default("I"),
      openingEmpMinor: z.coerce.number().int().min(0).default(0),
      openingErMinor: z.coerce.number().int().min(0).default(0),
      empContribPct: z.coerce.number().min(0).max(100).default(10),
      erContribPct: z.coerce.number().min(0).max(100).default(14),
    }).parse(req.body);
    const emp = await mustEmployee(ctx.tenantId, id);
    if (emp.pensionScheme !== "NPS") {
      throw new HttpError(409, "NOT_NPS_SCHEME", `employee is on ${emp.pensionScheme}, not NPS`);
    }
    // Synchronous pre-checks for both uniqueness constraints the DB enforces
    // (hrms_nps_accounts_uq on employee_id, hrms_nps_accounts_pran_uq on pran).
    // publishF3Write is fire-and-forget and NEVER rejects (see f3-publish.ts)
    // — a try/catch around it for a 23505 was dead code. Residual TOCTOU race:
    // two concurrent requests can both pass these reads before either
    // publishes; the DB unique constraints are the real backstop for that rare
    // case (the consumer's insert 23505s, logs "f3RouteWrite failed", and the
    // write is dropped — silently, from this client's point of view, since
    // fire-and-forget has no return channel). Closing that fully needs a
    // different mechanism (e.g. a client-supplied idempotency key) — out of
    // scope here.
    if (await repo.findAccountByEmployee(ctx.tenantId, id)) {
      throw new HttpError(409, "NPS_EXISTS", "NPS account already exists");
    }
    if (await repo.findAccountByPran(ctx.tenantId, body.pran)) {
      throw new HttpError(409, "PRAN_TAKEN", "PRAN already allocated");
    }

    const acctId = randomUUID();
    const openEmp = BigInt(body.openingEmpMinor);
    const openEr = BigInt(body.openingErMinor);
    await publishF3Write(ctx, "nps_routes__0", acctId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    return reply.code(201).send(jsonSafe({ id: acctId, employeeId: id, pran: body.pran, tier: body.tier }));
  });

  app.get("/v1/hrms/employees/:id/nps", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const acct = await mustAccount(ctx.tenantId, id);
    const [bal, ledger] = await Promise.all([
      repo.currentBalance(ctx.tenantId, acct),
      repo.listContributions(ctx.tenantId, acct.id),
    ]);
    return reply.send(jsonSafe({
      account: acct,
      runningBalanceMinor: bal.total,
      employeeBalanceMinor: bal.emp,
      employerBalanceMinor: bal.er,
      contributions: ledger,
    }));
  });

  app.post("/v1/hrms/employees/:id/nps/contribution", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM"),
      empAmountMinor: z.coerce.number().int().min(0).default(0),
      erAmountMinor: z.coerce.number().int().min(0).default(0),
      narrative: z.string().max(500).optional(),
      effectiveDate: z.string().optional(),
    }).refine((b) => b.empAmountMinor > 0 || b.erAmountMinor > 0, { message: "at least one of employee/employer amount required" })
      .parse(req.body);
    const acct = await mustAccount(ctx.tenantId, id);
    const empAmt = BigInt(body.empAmountMinor);
    const erAmt = BigInt(body.erAmountMinor);
    // Synchronous pre-check for the (account, period) uniqueness the DB
    // enforces via the partial unique index hrms_nps_contrib_period_uq. Same
    // fire-and-forget reasoning as the account-open pre-checks above.
    if (await repo.findContributionForPeriod(ctx.tenantId, acct.id, body.period)) {
      throw new HttpError(409, "PERIOD_ALREADY_POSTED", `NPS contribution for ${body.period} already posted`);
    }
    await publishF3Write(ctx, "nps_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    // No balance fields here: this crashed before (destructuring `{ prev, next }`
    // off publishF3Write's placeholder `{ id, status, correlationId }` — neither
    // field exists on it, see shared/f3-publish.ts). The real running balance
    // depends on every prior contribution and is computed by the consumer under
    // an advisory lock (repo.lockedBalance) specifically to serialize concurrent
    // postings against this account — a route-side read here would race that
    // lock. 202 + only what was actually validated, matching the GPF precedent
    // (`gpf/routes.ts`) and the CPF fix in this same PR for the identical
    // reason. Call GET /v1/hrms/employees/:id/nps for the authoritative balance.
    return reply.code(202).send(jsonSafe({
      employeeId: id, entryType: "contribution", period: body.period,
      empAmountMinor: empAmt, erAmountMinor: erAmt,
    })) as any;
  });

  app.post("/v1/hrms/employees/:id/nps/withdrawal", async (req, reply) => {
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
    // Synchronous pre-check mirroring the consumer's overdraft guard
    // (nps_routes__2: `if (prevBal.total - amount < 0n) throw new HttpError(409,
    // "INSUFFICIENT_BALANCE", ...)`). Unlike CPF's debit case, the NPS consumer
    // DOES throw (not a silent no-op) — so a rare TOCTOU race here (two
    // concurrent withdrawals both passing this same unlocked read) at least
    // surfaces as a logged "f3RouteWrite failed" / DLQ entry, even though that
    // failure still never reaches this client (fire-and-forget has no return
    // channel). This pre-check closes the common case; the DLQ entry is the
    // real backstop for the rare race, same residual-risk shape as the
    // unique-constraint checks above.
    const bal = await repo.currentBalance(ctx.tenantId, acct);
    if (bal.total - amount < 0n) {
      throw new HttpError(409, "INSUFFICIENT_BALANCE", `withdrawal of ${amount} exceeds the NPS corpus (${bal.total})`);
    }
    await publishF3Write(ctx, "nps_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> });
    // Same "cannot know the balance synchronously" reasoning as contribution
    // above — this was the crash at nps/routes.ts:128 (destructuring `{ prev,
    // next }` off the publishF3Write placeholder, then `next.total` throwing
    // TypeError on undefined).
    return reply.code(202).send(jsonSafe({ employeeId: id, entryType: "withdrawal", amountMinor: amount })) as any;
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
