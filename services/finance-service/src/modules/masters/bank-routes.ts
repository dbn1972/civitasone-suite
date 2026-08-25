/**
 * Bank Account master — the office's bank accounts for payments, EFT, reconciliation.
 * Without this, payments can't be issued.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { resolveContext, requireRole, financeErrorHandler } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

const FINANCE_ROLES = ["finance_admin", "super_admin"];

const paymentsSchema = pgSchema("payments");
const bankAccounts = paymentsSchema.table("finance_bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  bankName: varchar("bank_name", { length: 200 }).notNull(),
  branchName: varchar("branch_name", { length: 200 }),
  accountNo: encryptedText("account_no").notNull(),
  ifsc: encryptedText("ifsc").notNull(),
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
    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        bankName: r.bankName,
        branchName: r.branchName,
        accountNoLast4: String(r.accountNo).slice(-4),
        ifscPrefix: String(r.ifsc).slice(0, 4) + "XXXXXXX",
        accountType: r.accountType,
        purpose: r.purpose,
        status: r.status,
      })),
    });
  });

  app.post("/v1/finance/bank-accounts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createBankBody.parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.bankAccountCreate, {
      messageId: id,
      type: COMMANDS.bankAccountCreate,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: {
        id,
        tenantId: ctx.tenantId,
        bankName: body.bankName,
        branchName: body.branchName ?? null,
        accountNo: body.accountNo,
        ifsc: body.ifsc,
        accountType: body.accountType,
        purpose: body.purpose ?? null,
      },
    });
    return reply.code(202).send({ id, status: "accepted" });
  });

  app.setErrorHandler(financeErrorHandler);
}