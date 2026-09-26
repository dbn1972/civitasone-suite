import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { and, eq, ne, sql } from "drizzle-orm";
import { pgSchema, uuid, varchar, integer, timestamp, bigint, text, date } from "drizzle-orm/pg-core";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { encryptedText } from "../../shared/pii-crypto.js";
import { HttpError } from "../../shared/context.js";
import { assertOpeningBalancesBalanced, DomainError } from "./domain.js";
import { financePao, financeDdo } from "./schema.js";

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
  // BUG FIX (CRITICAL — silent no-op sync): both ddo_sync and pao_sync used to
  // only markProcessed + publish "finance.masters.synced" + write an audit
  // "success" entry -- there was no INSERT/UPDATE anywhere in either handler
  // (contrast COMMANDS.bankAccountCreate below, which does a real
  // tx.insert(bankAccounts)...). A sync could run any number of times,
  // report success every time, and GET /v1/finance/pao /ddo (routes.ts ->
  // repo.listPao/listDdo) would stay `{"data":[]}` forever.
  //
  // No real producer of either topic exists anywhere in this repo (verified,
  // not assumed): neither is in topics.ts's COMMANDS, no HTTP route or other
  // service publishes them, and both are listed in
  // tests/contract/{allowlist,known-defects}.json as
  // "undeclaredDeadSubscriptions" -- the only two real call sites were this
  // consumer's own queue.subscribe() and consumer-coverage-ext.test.ts, which
  // only ever published `{tenantId, source}`. So the payload contract below
  // is not a guess: paoCode/name/ministry and ddoCode/name/paoCode are
  // exactly (and only) the columns payments.finance_pao/finance_ddo have had
  // since migrations/0010_hoa_pao_voucher.sql (see that migration's own seed
  // INSERT), already read back by GET /v1/finance/pao/ddo, and already
  // exported as financePao/financeDdo from ./schema.js.
  //
  // A payload missing the required fields (paoCode+name, or ddoCode+name --
  // i.e. exactly what every real caller in this repo sends today) can no
  // longer silently "succeed": it throws a DomainError, which rolls back the
  // whole transaction (including markProcessed) and surfaces via
  // queue_consumer_error / DLQ, the same "fail loudly instead of lying"
  // pattern COMMANDS.openingBalancesEnter below already established for an
  // unbalanced entry set. See tests/masters-pao-ddo-sync.test.ts (real
  // Postgres, no mocks) for the regression proof, including that a re-sync
  // with the same paoCode/ddoCode updates the existing row instead of
  // duplicating it. Wiring an actual upstream producer (a real PFMS/CGA
  // master-data feed, or an internal admin form) is separate follow-up work
  // this PR does not attempt.
  queue.subscribe("finance.masters.ddo_sync", async (msg) => {
    const p = msg.payload as {
      tenantId: string; ddoCode: string; name: string;
      paoCode?: string | null; isActive?: boolean; source?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (!p.ddoCode || !p.name) {
        throw new DomainError(
          "DDO_SYNC_PAYLOAD_INCOMPLETE",
          "ddo_sync payload is missing required fields (ddoCode, name) -- cannot sync DDO master data without them",
        );
      }
      await tx.insert(financeDdo)
        .values({
          tenantId: p.tenantId, ddoCode: p.ddoCode, name: p.name,
          paoCode: p.paoCode ?? null, isActive: p.isActive ?? true,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        })
        .onConflictDoUpdate({
          target: [financeDdo.tenantId, financeDdo.ddoCode],
          set: {
            name: p.name, paoCode: p.paoCode ?? null, isActive: p.isActive ?? true,
            updatedBy: msg.actorId, updatedAt: new Date(),
            version: sql`${financeDdo.version} + 1`,
          },
        });
      await enqueue(tx, {
        topic: "finance.masters.synced", eventType: "finance.masters.synced",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { masterType: "ddo", source: p.source ?? "pfms" },
      });
      await audit(tx, msg, "sync_ddo", "masters", msg.messageId);
    });
    await cache.invalidateResource(msg.tenantId, "masters");
    log.info({ id: msg.messageId }, "Processed masters.ddo_sync");
  });

  queue.subscribe("finance.masters.pao_sync", async (msg) => {
    const p = msg.payload as {
      tenantId: string; paoCode: string; name: string;
      ministry?: string | null; isActive?: boolean; source?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (!p.paoCode || !p.name) {
        throw new DomainError(
          "PAO_SYNC_PAYLOAD_INCOMPLETE",
          "pao_sync payload is missing required fields (paoCode, name) -- cannot sync PAO master data without them",
        );
      }
      await tx.insert(financePao)
        .values({
          tenantId: p.tenantId, paoCode: p.paoCode, name: p.name,
          ministry: p.ministry ?? null, isActive: p.isActive ?? true,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        })
        .onConflictDoUpdate({
          target: [financePao.tenantId, financePao.paoCode],
          set: {
            name: p.name, ministry: p.ministry ?? null, isActive: p.isActive ?? true,
            updatedBy: msg.actorId, updatedAt: new Date(),
            version: sql`${financePao.version} + 1`,
          },
        });
      await enqueue(tx, {
        topic: "finance.masters.synced", eventType: "finance.masters.synced",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { masterType: "pao", source: p.source ?? "pfms" },
      });
      await audit(tx, msg, "sync_pao", "masters", msg.messageId);
    });
    await cache.invalidateResource(msg.tenantId, "masters");
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
    await cache.invalidateResource(msg.tenantId, "masters");
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
    await cache.invalidateResource(msg.tenantId, "masters");
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
    await cache.invalidateResource(msg.tenantId, "masters");
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
      // gl.finance_opening_balances already carries UNIQUE(tenant_id, fy_code,
      // account_code) (migrations/0022_fy_opening_balance.sql, present since
      // that file's first commit -- verified directly against a fresh
      // Postgres built from this repo's own migrations, not assumed). An
      // opening balance is entered once per account+FY: OpeningBalanceForm.tsx
      // always starts blank and has no edit/correct affordance, so a second
      // submission naming an account+FY that already has a row is a genuine
      // duplicate, not a correction, and must be rejected loudly.
      //
      // PROVEN silent-data-loss bug this closes: two finance_admins submitted
      // opening balances for the same account+FY (fyCode 2027-28, accounts
      // 1100/2202) concurrently with different amounts. Only the first
      // request's amounts persisted; the second got 202 accepted but its data
      // existed nowhere -- no row, no error, no log trace. Root cause: the
      // bare `.onConflictDoNothing()` below (no conflict target) silently
      // catches ANY unique-constraint violation on this table -- including
      // this natural-key one -- exactly like COMMANDS.fiscalYearCreate above
      // already relies on it to. Unlike that handler, this one never checked
      // whether a row was actually written, so the losing submission's insert
      // was silently skipped, the transaction still committed, and the
      // "success" audit event below still fired for data that was never
      // persisted. Checking `.returning().length` and throwing here rolls
      // back the WHOLE transaction (including markProcessed), so a
      // redelivery is rejected identically every time and the failure is
      // finally observable (queue_consumer_error / DLQ) instead of silent and
      // untraceable. See tests/masters-opening-balance-race.test.ts (real
      // Postgres, genuine concurrent Promise.all) for the regression proof.
      for (const entry of p.entries) {
        const inserted = await tx.insert(openingBalances).values({
          id: entry.id, tenantId: p.tenantId, fyCode: p.fyCode,
          accountCode: entry.accountCode,
          debitMinor: BigInt(entry.debitMinor),
          creditMinor: BigInt(entry.creditMinor),
          narration: entry.narration,
          enteredBy: msg.actorId,
        }).onConflictDoNothing().returning({ id: openingBalances.id });
        if (inserted.length === 0) {
          throw new DomainError(
            "OPENING_BALANCE_ALREADY_EXISTS",
            `an opening balance for account ${entry.accountCode} in FY ${p.fyCode} already exists`,
          );
        }
      }
      await audit(tx, msg, "enter_opening_balances", "opening_balance", p.id);
    });
    await cache.invalidateResource(msg.tenantId, "masters");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
