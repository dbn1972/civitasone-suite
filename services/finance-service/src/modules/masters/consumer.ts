import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { and, eq, ne } from "drizzle-orm";
import { pgSchema, uuid, varchar, integer, timestamp, bigint, text, date } from "drizzle-orm/pg-core";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { encryptedText } from "../../shared/pii-crypto.js";
import { HttpError } from "../../shared/context.js";
import { assertOpeningBalancesBalanced } from "./domain.js";

const log = pino({ name: "finance.masters.consumer" });
const AUDIT_TOPIC = "audit.event.record";

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

export function registerMastersConsumers(queue: Queue): void {
  queue.subscribe("finance.masters.ddo_sync", async (msg) => {
    const p = msg.payload as { tenantId: string; source?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "finance.masters.synced", eventType: "finance.masters.synced",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { masterType: "ddo", source: p.source ?? "pfms" },
      });
      await audit(tx, msg, "sync_ddo", "masters", msg.messageId);
    });
    await cache.invalidate(`finance:${msg.tenantId}:masters:*`);
    log.info({ id: msg.messageId }, "Processed masters.ddo_sync");
  });

  queue.subscribe("finance.masters.pao_sync", async (msg) => {
    const p = msg.payload as { tenantId: string; source?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "finance.masters.synced", eventType: "finance.masters.synced",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { masterType: "pao", source: p.source ?? "pfms" },
      });
      await audit(tx, msg, "sync_pao", "masters", msg.messageId);
    });
    await cache.invalidate(`finance:${msg.tenantId}:masters:*`);
    log.info({ id: msg.messageId }, "Processed masters.pao_sync");
  });

  queue.subscribe(COMMANDS.bankAccountCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; bankName: string; branchName: string | null;
      accountNo: string; ifsc: string; accountType: string; purpose: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(bankAccounts).values({
        id: p.id, tenantId: p.tenantId, bankName: p.bankName,
        branchName: p.branchName, accountNo: p.accountNo, ifsc: p.ifsc,
        accountType: p.accountType, purpose: p.purpose, createdBy: msg.actorId,
      });
      await audit(tx, msg, "create_bank_account", "bank_account", p.id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:masters:*`);
  });

  queue.subscribe(COMMANDS.fiscalYearCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; code: string; label: string; startDate: string; endDate: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inserted = await tx.insert(fiscalYears).values({
        id: p.id, tenantId: p.tenantId, code: p.code, label: p.label,
        startDate: p.startDate, endDate: p.endDate, status: "active", createdBy: msg.actorId,
      }).onConflictDoNothing().returning({ id: fiscalYears.id });
      if (inserted.length === 0) {
        throw new HttpError(409, "ALREADY_EXISTS", `fiscal year ${p.code} already exists`);
      }
      await tx.update(fiscalYears)
        .set({ status: "closed" })
        .where(and(eq(fiscalYears.tenantId, p.tenantId), eq(fiscalYears.status, "active"), ne(fiscalYears.id, p.id)));
      await audit(tx, msg, "create_fiscal_year", "fiscal_year", p.id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:masters:*`);
  });

  queue.subscribe(COMMANDS.fiscalYearActivate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; code: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.update(fiscalYears)
        .set({ status: "closed" })
        .where(and(eq(fiscalYears.tenantId, p.tenantId), eq(fiscalYears.status, "active")));
      await tx.update(fiscalYears)
        .set({ status: "active" })
        .where(and(eq(fiscalYears.tenantId, p.tenantId), eq(fiscalYears.code, p.code)));
      await audit(tx, msg, "activate_fiscal_year", "fiscal_year", p.code);
    });
    await cache.invalidate(`finance:${msg.tenantId}:masters:*`);
  });

  queue.subscribe(COMMANDS.openingBalancesEnter, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; fyCode: string;
      entries: Array<{ id: string; accountCode: string; debitMinor: number; creditMinor: number; narration: string | null }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Non-bypassable enforcement (mirrors gl/consumer.ts's postJournal
      // calling assertJournalBalances right before it inserts anything): even
      // if a caller publishes this command directly -- skipping the HTTP
      // route's own check in fy-routes.ts -- an unbalanced set can never
      // reach the ledger. Throwing here rolls back the whole transaction,
      // including the markProcessed row, so a redelivery is rejected the
      // same way every time rather than being silently swallowed.
      assertOpeningBalancesBalanced(p.entries);
      for (const entry of p.entries) {
        await tx.insert(openingBalances).values({
          id: entry.id, tenantId: p.tenantId, fyCode: p.fyCode,
          accountCode: entry.accountCode,
          debitMinor: BigInt(entry.debitMinor),
          creditMinor: BigInt(entry.creditMinor),
          narration: entry.narration,
          enteredBy: msg.actorId,
        }).onConflictDoNothing();
      }
      await audit(tx, msg, "enter_opening_balances", "opening_balance", p.id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:masters:*`);
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
