/**
 * Financial Year + Opening Balance configuration routes.
 * These are the #1 blocker for a tenant going live on finance — without them,
 * the books have no starting point.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { pgSchema, uuid, varchar, integer, timestamp, bigint, text, date } from "drizzle-orm/pg-core";

const FINANCE_ROLES = ["finance_admin", "super_admin"];

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

const createFYBody = z.object({
  code: z.string().regex(/^\d{4}-\d{2}$/, "Must be YYYY-YY, e.g. 2026-27"),
  label: z.string().min(2).max(64),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const openingBalanceBody = z.object({
  fyCode: z.string().regex(/^\d{4}-\d{2}$/),
  entries: z.array(z.object({
    accountCode: z.string().min(1).max(20),
    debitMinor: z.number().int().nonnegative().default(0),
    creditMinor: z.number().int().nonnegative().default(0),
    narration: z.string().max(500).optional(),
  })).min(1).max(500),
});

export async function fyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/fiscal-years", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(fiscalYears).where(eq(fiscalYears.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/fiscal-years", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createFYBody.parse(req.body);
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
    requireRole(ctx, FINANCE_ROLES);
    const code = (req.params as { code: string }).code;
    const id = randomUUID();
    await queue.publish(COMMANDS.fiscalYearActivate, {
      messageId: id,
      type: COMMANDS.fiscalYearActivate,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, code },
    });
    return reply.code(202).send({ id, status: "accepted", code });
  });

  app.get("/v1/finance/opening-balances/:fyCode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const fyCode = (req.params as { fyCode: string }).fyCode;
    const rows = await scopedRead((tx) => tx.select().from(openingBalances)
      .where(and(eq(openingBalances.tenantId, ctx.tenantId), eq(openingBalances.fyCode, fyCode))));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/opening-balances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = openingBalanceBody.parse(req.body);
    const id = randomUUID();
    const entries = body.entries.map((e) => ({
      id: randomUUID(),
      accountCode: e.accountCode,
      debitMinor: e.debitMinor,
      creditMinor: e.creditMinor,
      narration: e.narration ?? null,
    }));
    await queue.publish(COMMANDS.openingBalancesEnter, {
      messageId: id,
      type: COMMANDS.openingBalancesEnter,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, fyCode: body.fyCode, entries },
    });
    return reply.code(202).send({ id, status: "accepted", count: entries.length });
  });
}
