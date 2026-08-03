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
    if (await repo.findAccountByEmployee(ctx.tenantId, id)) {
      throw new HttpError(409, "NPS_EXISTS", "NPS account already exists");
    }

    const acctId = randomUUID();
    const openEmp = BigInt(body.openingEmpMinor);
    const openEr = BigInt(body.openingErMinor);
    try {
      await publishF3Write(ctx, "nps_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "PRAN_TAKEN", "PRAN already allocated");
      throw err;
    }
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
    const ledgerId = randomUUID();
    try {
      const { prev, next } = await publishF3Write(ctx, "nps_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
      return reply.code(201).send(jsonSafe({
        ledgerId, period: body.period, empAmountMinor: empAmt, erAmountMinor: erAmt,
        previousBalanceMinor: prev.total, balanceMinor: next.total,
        employeeBalanceMinor: next.emp, employerBalanceMinor: next.er,
      }));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpError(409, "PERIOD_ALREADY_POSTED", `NPS contribution for ${body.period} already posted`);
      }
      throw err;
    }
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
    const ledgerId = randomUUID();
    const { prev, next } = await publishF3Write(ctx, "nps_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send(jsonSafe({
      ledgerId, entryType: "withdrawal", amountMinor: amount,
      previousBalanceMinor: prev.total, balanceMinor: next.total,
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
