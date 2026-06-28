/**
 * Financial Year + Opening Balance configuration routes.
 * These are the #1 blocker for a tenant going live on finance — without them,
 * the books have no starting point.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { pgSchema, uuid, varchar, integer, timestamp, bigint, text, date } from "drizzle-orm/pg-core";

const FINANCE_ROLES = ["finance_admin", "super_admin"];

// ── Schema (mirrors migration 0022) ──
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

// ── Validators ──
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

// ── Routes ──
export async function fyRoutes(app: FastifyInstance): Promise<void> {
  // List financial years
  app.get("/v1/finance/fiscal-years", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const rows = await db.select().from(fiscalYears).where(eq(fiscalYears.tenantId, ctx.tenantId));
    return reply.send({ data: rows });
  });

  // Create a financial year
  app.post("/v1/finance/fiscal-years", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createFYBody.parse(req.body);
    const id = randomUUID();
    await db.insert(fiscalYears).values({
      id, tenantId: ctx.tenantId, code: body.code, label: body.label,
      startDate: body.startDate, endDate: body.endDate, status: "active",
      createdBy: ctx.actorId,
    }).onConflictDoNothing();
    return reply.code(201).send({ id, status: "created" });
  });

  // Set a FY as active (close the previous one)
  app.patch("/v1/finance/fiscal-years/:code/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const code = (req.params as { code: string }).code;
    // Deactivate all others
    await db.update(fiscalYears)
      .set({ status: "closed" })
      .where(and(eq(fiscalYears.tenantId, ctx.tenantId), eq(fiscalYears.status, "active")));
    // Activate the target
    await db.update(fiscalYears)
      .set({ status: "active" })
      .where(and(eq(fiscalYears.tenantId, ctx.tenantId), eq(fiscalYears.code, code)));
    return reply.send({ status: "activated", code });
  });

  // List opening balances for a FY
  app.get("/v1/finance/opening-balances/:fyCode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const fyCode = (req.params as { fyCode: string }).fyCode;
    const rows = await db.select().from(openingBalances)
      .where(and(eq(openingBalances.tenantId, ctx.tenantId), eq(openingBalances.fyCode, fyCode)));
    return reply.send({ data: rows });
  });

  // Enter opening balances (bulk upsert)
  app.post("/v1/finance/opening-balances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = openingBalanceBody.parse(req.body);

    let inserted = 0;
    for (const entry of body.entries) {
      await db.insert(openingBalances).values({
        id: randomUUID(),
        tenantId: ctx.tenantId,
        fyCode: body.fyCode,
        accountCode: entry.accountCode,
        debitMinor: BigInt(entry.debitMinor),
        creditMinor: BigInt(entry.creditMinor),
        narration: entry.narration ?? null,
        enteredBy: ctx.actorId,
      }).onConflictDoNothing();
      inserted++;
    }
    return reply.code(201).send({ status: "entered", count: inserted });
  });
}
