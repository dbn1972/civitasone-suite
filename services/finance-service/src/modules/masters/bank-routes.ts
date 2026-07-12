/**
 * Bank Account master — the office's bank accounts for payments, EFT, reconciliation.
 * Without this, payments can't be issued.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { pgSchema, uuid, varchar, integer, timestamp, text } from "drizzle-orm/pg-core";

const FINANCE_ROLES = ["finance_admin", "super_admin"];

const paymentsSchema = pgSchema("payments");
const bankAccounts = paymentsSchema.table("finance_bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  bankName: varchar("bank_name", { length: 200 }).notNull(),
  branchName: varchar("branch_name", { length: 200 }),
  accountNo: varchar("account_no", { length: 30 }).notNull(),
  ifsc: varchar("ifsc", { length: 11 }).notNull(),
  accountType: varchar("account_type", { length: 20 }).notNull().default("current"),
  purpose: varchar("purpose", { length: 64 }),
  status: varchar("status", { length: 12 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

const createBankBody = z.object({
  bankName: z.string().min(2, "Bank name is required").max(200),
  branchName: z.string().max(200).optional(),
  accountNo: z.string().min(5, "Account number is required").max(30),
  ifsc: z.string().length(11, "IFSC must be 11 characters"),
  accountType: z.enum(["savings", "current", "overdraft"]).default("current"),
  purpose: z.string().max(64).optional(),
});

export async function bankRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/bank-accounts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(bankAccounts).where(eq(bankAccounts.tenantId, ctx.tenantId)));
    return reply.send({ data: rows });
  });

  app.post("/v1/finance/bank-accounts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createBankBody.parse(req.body);
    const id = randomUUID();
    await db.insert(bankAccounts).values({
      id, tenantId: ctx.tenantId, ...body,
      branchName: body.branchName ?? null, purpose: body.purpose ?? null,
      createdBy: ctx.actorId,
    });
    return reply.code(201).send({ id, status: "created" });
  });
}
