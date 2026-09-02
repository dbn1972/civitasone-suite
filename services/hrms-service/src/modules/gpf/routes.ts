import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
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
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead} from "../../shared/db.js";
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
  const rows = await scopedRead((tx) => tx.select().from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, tenantId))).limit(1));
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
    await publishF3Write(ctx, "gpf_routes__0", acctId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send(jsonSafe({ id: acctId, employeeId: id, gpfNumber: body.gpfNumber, openingBalanceMinor: opening })) as any;
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
    // Synchronous pre-check (existence), same pattern as employee/agent1-gap-routes.ts:
    // the consumer 404s on a missing account too, but only AFTER this route would
    // otherwise have already replied — so mirror the check here.
    await mustAccount(ctx.tenantId, id);
    const amount = BigInt(body.amountMinor);
    const ledgerId = randomUUID();
    // publishF3Write is fire-and-forget: the actual ledger write (lock the
    // account, read the balance, guard INSUFFICIENT_BALANCE, insert) happens
    // later in the consumer inside its own transaction (C1), so this route
    // cannot know the resulting previous/next balance synchronously — it
    // used to destructure `{ prev, next }` off publishF3Write's return value,
    // but that call only ever resolves `{ id, status, correlationId }`, so
    // both were always `undefined`. Forward `entryType` and `sign` instead:
    // all four routes that share this helper publish the same op with
    // otherwise byte-identical payloads, so without them the consumer cannot
    // tell a subscription from a withdrawal and must refuse to guess the
    // credit/debit sign on a statutory PF ledger.
    await publishF3Write(ctx, "gpf_routes__1", ledgerId, {
      body: (req.body as Record<string, unknown>) ?? {},
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      entryType, sign,
    });
    return reply.code(202).send(jsonSafe({
      ledgerId, entryType, amountMinor: amount, status: "accepted",
    })) as any;
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
    // Same reasoning as post() above: the consumer reads the locked balance
    // inside its own transaction so interest accrues on the true, serialised
    // balance rather than a stale pre-tx read (C1), which means the actual
    // interestMinor/previous/next balance genuinely cannot be known here,
    // synchronously — it used to destructure `{ prev, interest, next }` off
    // publishF3Write's return value, which never carries them. Report only
    // what this route itself decided (rate, months, ledger id); the caller
    // reads GET /gpf for the posted amount and resulting balance once the
    // write lands.
    await publishF3Write(ctx, "gpf_routes__2", ledgerId, {
      body: (req.body as Record<string, unknown>) ?? {},
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
    });
    return reply.code(202).send(jsonSafe({
      ledgerId, ratePct, months: body.months, status: "accepted",
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
