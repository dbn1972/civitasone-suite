import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { and, eq, sql } from "drizzle-orm";
import { pgSchema, uuid, varchar, integer, timestamp, date } from "drizzle-orm/pg-core";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { encryptedText } from "../../shared/pii-crypto.js";
import { HttpError } from "../../shared/context.js";
import { assertFiscalYearRangeValid, sameBankAccount, DomainError } from "./domain.js";
import { applyFiscalYearActivation, applyOpeningBalances } from "../approvals/apply.js";
import { loadSettingsTx } from "../approvals/repo.js";
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
      await lockTenant(tx, "bank", p.tenantId);
      const banks = await tx.select({ accountNo: bankAccounts.accountNo, ifsc: bankAccounts.ifsc })
        .from(bankAccounts).where(eq(bankAccounts.tenantId, p.tenantId));
      if (banks.some((b: { accountNo: unknown; ifsc: unknown }) => sameBankAccount({ accountNo: String(b.accountNo), ifsc: String(b.ifsc) }, p))) {
        throw new DomainError("BANK_ACCOUNT_EXISTS", "this bank account (IFSC + account number) is already registered");
      }
      await tx.insert(bankAccounts).values({
        id: p.id, tenantId: p.tenantId, bankName: p.bankName,
        branchName: p.branchName, accountNo: p.accountNo, ifsc: p.ifsc,
        accountType: p.accountType, purpose: p.purpose, createdBy: msg.actorId,
      });
      await audit(tx, msg, "create_bank_account", "bank_account", p.id);
    });
    await cache.invalidateResource(msg.tenantId, "masters");
  });

  // GAP-FINANCE-CONFIG-02: audit trail for an unmasked bank-account read (actor + reason; never the number).
  queue.subscribe(COMMANDS.bankAccountReveal, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string; accountNoLast4: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await audit(tx, msg, "reveal_bank_account", "bank_account", p.id, { reason: p.reason, accountNoLast4: p.accountNoLast4 });
    });
  });

  queue.subscribe(COMMANDS.fiscalYearCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; code: string; label: string; startDate: string; endDate: string;
      reason?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // GAP-FINANCE-FISCAL-YEARS-01 (review D2): serialise every fiscal-year
      // write for the tenant so the overlap re-check below and the
      // single-active invariant hold under concurrency (READ COMMITTED alone
      // let two overlapping creates, or two activates, both commit).
      await lockTenant(tx, "fy", p.tenantId);
      // Racing-create guard: re-check duplicate/overlap inside the tx (the
      // route's pre-check can't see a concurrent, not-yet-committed insert).
      const existingYears = await tx.select({
        code: fiscalYears.code, startDate: fiscalYears.startDate, endDate: fiscalYears.endDate, status: fiscalYears.status,
      }).from(fiscalYears).where(eq(fiscalYears.tenantId, p.tenantId));
      assertFiscalYearRangeValid(p, existingYears);
      const previouslyActive = existingYears.filter((y) => y.status === "active").map((y) => y.code);
      // GAP-FINANCE-FISCAL-YEARS-01: while another year is active, a new year is
      // created as `draft` (per-tenant setting, default on) so entering next
      // year early never switches the posting year. Only the Activate action,
      // with a reason, a clean period close and a second approver, does that.
      // A tenant with no active year gets its first year active straight away.
      const settings = await loadSettingsTx(tx, p.tenantId);
      const asDraft = settings.fyCreateAsDraft && previouslyActive.length > 0;
      // Close the current active year BEFORE inserting an active one: gl.finance_fiscal_years has a partial
      // unique index (one active year per tenant), so the swap must never have two active rows at once.
      // If the insert below fails (duplicate code) the whole transaction rolls back, undoing the close.
      if (!asDraft) {
        await tx.update(fiscalYears)
          .set({ status: "closed" })
          .where(and(eq(fiscalYears.tenantId, p.tenantId), eq(fiscalYears.status, "active")));
      }
      const inserted = await tx.insert(fiscalYears).values({
        id: p.id, tenantId: p.tenantId, code: p.code, label: p.label,
        startDate: p.startDate, endDate: p.endDate, status: asDraft ? "draft" : "active", createdBy: msg.actorId,
      }).onConflictDoNothing().returning({ id: fiscalYears.id });
      if (inserted.length === 0) {
        throw new HttpError(409, "ALREADY_EXISTS", `fiscal year ${p.code} already exists`);
      }
      await audit(tx, msg, "create_fiscal_year", "fiscal_year", p.id, {
        code: p.code, reason: p.reason ?? null, status: asDraft ? "draft" : "active",
        closedFiscalYears: asDraft ? [] : previouslyActive,
      });
    });
    await cache.invalidateResource(msg.tenantId, "masters");
  });

  queue.subscribe(COMMANDS.fiscalYearActivate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; code: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Shared with the maker-checker approval path (approvals/apply.ts): the
      // target must exist (never close the current year for a typo), the
      // outgoing year's periods must be hard-closed (per-tenant setting), and
      // the swap runs under the tenant's fiscal-year advisory lock.
      await applyFiscalYearActivation(
        tx, { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
        { code: p.code, reason: p.reason ?? "" },
      );
    });
    await cache.invalidateResource(msg.tenantId, "masters");
  });

  queue.subscribe(COMMANDS.openingBalancesEnter, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; fyCode: string; reason?: string;
      // string (paise) since GAP-FINANCE-OPENING-BALANCES-01; number accepted
      // for any message enqueued by the previous route version.
      entries: Array<{ id: string; accountCode: string; debitMinor: string | number; creditMinor: string | number; narration: string | null }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Non-bypassable enforcement (balanced entries, one balance per
      // account+FY, loud failure instead of a silent drop) lives in
      // approvals/apply.ts so the direct path and the maker-checker approval
      // path run the exact same checks. Throwing rolls back the whole
      // transaction, including markProcessed, so a redelivery is rejected the
      // same way every time. See tests/masters-opening-balance-race.test.ts.
      await applyOpeningBalances(
        tx, { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
        { id: p.id, fyCode: p.fyCode, entries: p.entries, reason: p.reason ?? "" },
      );
    });
    await cache.invalidateResource(msg.tenantId, "masters");
  });
}

/** Per-tenant transaction-scoped advisory lock (same pattern as period-close/repo.ts lockPeriodTx). */
async function lockTenant(tx: any, scope: string, tenantId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${scope}:${tenantId}`}))`);
}

async function audit(
  tx: any, msg: any, action: string, resourceType: string, resourceId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  // `details` (e.g. the officer's stated reason) rides in the audit payload,
  // which audit-service binds into the tamper-evident hash chain.
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { ...details, service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
