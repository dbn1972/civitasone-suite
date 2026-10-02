/**
 * Financial Year + Opening Balance configuration routes.
 * These are the #1 blocker for a tenant going live on finance — without them,
 * the books have no starting point.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { zMoneyMinor } from "@civitasone/schemas/money";
import { financeHeads } from "../budget/schema.js";
import { assertOpeningBalancesBalanced, assertFiscalYearRangeValid, DomainError } from "./domain.js";
import { pgSchema, uuid, varchar, integer, timestamp, bigint, text, date } from "drizzle-orm/pg-core";

// UX-medium finding: this used to be a single FINANCE_ROLES = ["finance_admin",
// "super_admin"] gating BOTH reads and writes here -- unlike every sibling
// finance-service module (gl/routes.ts, budget/*, payments, treasury, pfms,
// ...), which all split a broader READER_ROLES (includes finance_officer,
// audit_officer) from a narrower WRITER_ROLES for the actual mutation. That
// meant a plain finance_officer/accountant got a 403 even just VIEWING
// fiscal years or opening balances -- the read-only case this file's own
// sibling in the same module, masters/routes.ts, already gets right
// (READER_ROLES = [...FINANCE_ROLES, "audit_officer"] there). Split the same
// way here; opening-balance ENTRY stays WRITER_ROLES-only (finance_admin/
// super_admin) since it's an irreversible starting position for the books,
// same tier as masters/bank-routes.ts's bank-account writes.
const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
const WRITER_ROLES = ["finance_admin", "super_admin"];

const glSchema = pgSchema("gl");

const fiscalYears = glSchema.table("finance_fiscal_years", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 9 }).notNull(),
  label: varchar("label", { length: 64 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: varchar("status", { length: 12 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

const openingBalances = glSchema.table("finance_opening_balances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  fyCode: varchar("fy_code", { length: 9 }).notNull(),
  accountCode: varchar("account_code", { length: 20 }).notNull(),
  debitMinor: bigint("debit_minor", { mode: "bigint" }).notNull().default(0n),
  creditMinor: bigint("credit_minor", { mode: "bigint" }).notNull().default(0n),
  narration: text("narration"),
  enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
  enteredBy: uuid("entered_by").notNull(),
  version: integer("version").notNull().default(1),
});

// GAP-FINANCE-FISCAL-YEARS-01/-02, GAP-FINANCE-OPENING-BALANCES-01: every
// write on this file changes which year postings land in or seeds the
// ledger, so each one now carries a mandatory stated reason that is recorded
// in the tamper-evident audit event (masters/consumer.ts).
const reasonField = z.string().trim().min(10, "Reason must be at least 10 characters").max(500);

/** YYYY-MM-DD that is a real calendar date (2030-02-31 is rejected, not cast-failed in the worker). */
const isoCalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((d) => {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}, "Not a valid calendar date");

const createFYBody = z.object({
  code: z.string().regex(/^\d{4}-\d{2}$/, "Must be YYYY-YY, e.g. 2026-27"),
  label: z.string().min(2).max(64),
  startDate: isoCalendarDate,
  endDate: isoCalendarDate,
  reason: reasonField,
});

const activateFYBody = z.object({ reason: reasonField });

// Opening balances are paise and may exceed 2^53 in aggregate: decode with
// the canonical bigint-safe money codec (string | safe-integer number), never
// a bare z.number() that silently rounds above 2^53 at JSON.parse time.
// Upper bound = Postgres BIGINT max: anything larger would pass here and
// then fail the insert in the worker after a 202.
const PG_BIGINT_MAX = 9223372036854775807n;
const moneyMinorNonNeg = zMoneyMinor.pipe(z.bigint().nonnegative().max(PG_BIGINT_MAX, "Amount is too large"));

const openingBalanceBody = z.object({
  fyCode: z.string().regex(/^\d{4}-\d{2}$/),
  entries: z.array(z.object({
    accountCode: z.string().min(1).max(20),
    debitMinor: moneyMinorNonNeg.default(0n),
    creditMinor: moneyMinorNonNeg.default(0n),
    narration: z.string().max(500).optional(),
  })).min(1).max(500),
  reason: reasonField,
});

export async function fyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/fiscal-years", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(fiscalYears).where(eq(fiscalYears.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/fiscal-years", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const body = createFYBody.parse(req.body);
    // Synchronous duplicate/overlap pre-check (the consumer re-checks inside
    // its transaction for the racing case).
    const existing = await scopedRead((tx) => tx.select({
      code: fiscalYears.code, startDate: fiscalYears.startDate, endDate: fiscalYears.endDate,
    }).from(fiscalYears).where(eq(fiscalYears.tenantId, ctx.tenantId)));
    try {
      assertFiscalYearRangeValid(body, existing);
    } catch (err) {
      if (err instanceof DomainError) {
        throw new HttpError(err.code === "FY_INVALID_RANGE" ? 400 : 409, err.code, err.message);
      }
      throw err;
    }
    const id = randomUUID();
    await queue.publish(COMMANDS.fiscalYearCreate, {
      messageId: id,
      type: COMMANDS.fiscalYearCreate,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ id, status: "accepted" });
  });

  app.patch("/v1/finance/fiscal-years/:code/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const { code } = z.object({ code: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.params);
    const body = activateFYBody.parse(req.body ?? {});
    // Previously a typo'd/unknown code was accepted (202) and the consumer
    // then closed the current active year while activating nothing, leaving
    // the tenant with NO posting year. Reject it up front instead.
    const rows = await scopedRead((tx) => tx.select({ code: fiscalYears.code, status: fiscalYears.status })
      .from(fiscalYears).where(eq(fiscalYears.tenantId, ctx.tenantId)));
    const target = rows.find((r) => r.code === code);
    if (!target) throw new HttpError(404, "NOT_FOUND", `fiscal year ${code} not found`);
    if (target.status === "active") throw new HttpError(409, "ALREADY_ACTIVE", `fiscal year ${code} is already active`);
    const id = randomUUID();
    await queue.publish(COMMANDS.fiscalYearActivate, {
      messageId: id,
      type: COMMANDS.fiscalYearActivate,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, code, reason: body.reason },
    });
    return reply.code(202).send({ id, status: "accepted", code });
  });

  app.get("/v1/finance/opening-balances/:fyCode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const fyCode = (req.params as { fyCode: string }).fyCode;
    const rows = await scopedRead((tx) => tx.select().from(openingBalances)
      .where(and(eq(openingBalances.tenantId, ctx.tenantId), eq(openingBalances.fyCode, fyCode))));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/opening-balances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITER_ROLES);
    const body = openingBalanceBody.parse(req.body);
    // Server-side balanced-entry enforcement: the client's own "fail closed"
    // balance check is trivially bypassable by a direct API call, which
    // would otherwise let an unbalanced opening trial balance straight
    // through. Mirrors gl/domain.ts's assertJournalBalances; the consumer
    // below re-checks the same invariant right before insert so a caller
    // that publishes the command directly (skipping this route) can't
    // bypass it either.
    try {
      assertOpeningBalancesBalanced(body.entries);
    } catch (err) {
      if (err instanceof DomainError) throw new HttpError(400, err.code, err.message);
      throw err;
    }

    // GAP-FINANCE-OPENING-BALANCES-06: a closed fiscal year takes no opening balances
    // (a year with no row yet is left to the existing flow). Real statuses: active|closed|draft.
    const [fy] = await scopedRead((tx) => tx.select({ status: fiscalYears.status }).from(fiscalYears)
      .where(and(eq(fiscalYears.tenantId, ctx.tenantId), eq(fiscalYears.code, body.fyCode))).limit(1));
    if (fy?.status === "closed") {
      throw new HttpError(409, "FISCAL_YEAR_CLOSED", `fiscal year ${body.fyCode} is closed; opening balances cannot be entered`);
    }

    // GAP-FINANCE-OPENING-BALANCES-03: every account code must exist in this tenant's chart of
    // accounts (budget.finance_heads; GET /v1/finance/accounts reports every head as active, so
    // existence is the activity test). The client's datalist check is advisory only.
    const wantedCodes = [...new Set(body.entries.map((e) => e.accountCode))];
    const knownRows = await scopedRead((tx) => tx.select({ code: financeHeads.code }).from(financeHeads)
      .where(and(eq(financeHeads.tenantId, ctx.tenantId), inArray(financeHeads.code, wantedCodes))));
    const known = new Set(knownRows.map((r) => r.code));
    const unknownCodes = wantedCodes.filter((c) => !known.has(c));
    if (unknownCodes.length > 0) {
      throw new HttpError(400, "ACCOUNT_NOT_FOUND", `account code(s) not in the chart of accounts: ${unknownCodes.join(", ")}`);
    }

    // Synchronous duplicate pre-check: an opening balance is entered once per
    // account+FY (OpeningBalanceForm.tsx always starts blank -- there is no
    // edit/correct flow), so a resubmission naming an account+FY that already
    // has a row is a duplicate, not a correction. This catches the common
    // (non-racing) case -- e.g. a second finance_admin submitting minutes
    // later without noticing the balances table below the form already has
    // rows -- with an immediate, honest 409 instead of a false 202.
    //
    // This is a fast-path convenience, not the authoritative guard: two
    // requests that race within this same window can both pass it (neither
    // commit is visible to the other yet), exactly like this file's balanced-
    // entries check above and COMMANDS.fiscalYearCreate's ALREADY_EXISTS both
    // already accept for their own synchronous pre-checks. The consumer's
    // insert-time conflict check (masters/consumer.ts) is what makes THAT
    // case non-bypassable: it can't stop the second caller's HTTP response
    // from already having gone out as 202, but it does guarantee the loser is
    // never silently dropped -- rejected loudly and traceably instead.
    const existing = await scopedRead((tx) => tx.select({ accountCode: openingBalances.accountCode })
      .from(openingBalances)
      .where(and(eq(openingBalances.tenantId, ctx.tenantId), eq(openingBalances.fyCode, body.fyCode))));
    const existingCodes = new Set(existing.map((r) => r.accountCode));
    const duplicateCodes = [...new Set(body.entries.map((e) => e.accountCode).filter((code) => existingCodes.has(code)))];
    if (duplicateCodes.length > 0) {
      throw new HttpError(
        409,
        "OPENING_BALANCE_ALREADY_EXISTS",
        `an opening balance already exists for FY ${body.fyCode}, account(s): ${duplicateCodes.join(", ")}`,
      );
    }

    const id = randomUUID();
    // Paise travel as base-10 strings on the queue (JSON has no bigint).
    const entries = body.entries.map((e) => ({
      id: randomUUID(),
      accountCode: e.accountCode,
      debitMinor: e.debitMinor.toString(),
      creditMinor: e.creditMinor.toString(),
      narration: e.narration ?? null,
    }));
    await queue.publish(COMMANDS.openingBalancesEnter, {
      messageId: id,
      type: COMMANDS.openingBalancesEnter,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, fyCode: body.fyCode, entries, reason: body.reason },
    });
    return reply.code(202).send({ id, status: "accepted", count: entries.length });
  });

  // Previously missing: without the shared finance error handler a ZodError
  // (any malformed body on these routes) surfaced as an untriaged 500 instead
  // of a 400 with fieldErrors, unlike every sibling finance module.
  app.setErrorHandler(financeErrorHandler);
}
