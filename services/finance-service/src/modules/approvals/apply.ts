/**
 * The state changes a maker-checker change request performs once approved.
 *
 * Each function is used by BOTH paths: the direct consumers (second-approver
 * setting off) and the change-request decision consumer (setting on), so the
 * two can never drift. Every function validates BEFORE it writes, so a
 * DomainError leaves the transaction with no partial effect.
 */
import { and, eq, sql, inArray } from "drizzle-orm";
import { pgSchema, uuid, varchar, integer, timestamp, bigint, text, date } from "drizzle-orm/pg-core";
import { enqueue } from "../../shared/outbox.js";
import type { Db } from "../../shared/db.js";
import { financeHeads } from "../budget/schema.js";
import { assertOpeningBalancesBalanced, DomainError } from "../masters/domain.js";
import { assertFiscalYearActivationAllowed } from "./domain.js";
import { loadSettingsTx } from "./repo.js";
import { financeSettings } from "./schema.js";
import type { FinanceSettings } from "./domain.js";

/** An open tenant transaction (what db.transaction hands its callback). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ActorMeta = { tenantId: string; actorId: string; correlationId: string };

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
const periodClose = glSchema.table("finance_period_close", {
  tenantId: uuid("tenant_id").notNull(),
  period: varchar("period", { length: 7 }).notNull(),
  status: varchar("status", { length: 12 }).notNull(),
});

const AUDIT_TOPIC = "audit.event.record";

/** Per-tenant transaction-scoped advisory lock (same pattern as masters/consumer.ts). */
export async function lockTenant(tx: Tx, scope: string, tenantId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${scope}:${tenantId}`}))`);
}

export async function auditEvent(
  tx: Tx, meta: ActorMeta, action: string, resourceType: string, resourceId: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: meta.tenantId, actorId: meta.actorId, correlationId: meta.correlationId,
    payload: { ...details, service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}

/** Read-only pre-flight used by the route (sync 409) AND the apply step (race-safe re-check). */
export async function checkFiscalYearActivation(tx: Pick<Db, "select">, tenantId: string, code: string): Promise<{ closing: string[] }> {
  const years = await tx.select({
    code: fiscalYears.code, status: fiscalYears.status, startDate: fiscalYears.startDate, endDate: fiscalYears.endDate,
  }).from(fiscalYears).where(eq(fiscalYears.tenantId, tenantId));
  const target = years.find((y: { code: string }) => y.code === code);
  if (!target) throw new DomainError("NOT_FOUND", `fiscal year ${code} not found`);
  if (target.status === "active") throw new DomainError("ALREADY_ACTIVE", `fiscal year ${code} is already active`);
  const outgoing = years.filter((y: { code: string; status: string }) => y.status === "active" && y.code !== code);
  const settings = await loadSettingsTx(tx, tenantId);
  const periodRows = await tx.select({ period: periodClose.period, status: periodClose.status })
    .from(periodClose).where(eq(periodClose.tenantId, tenantId));
  const [cnt] = await tx.select({ n: sql<number>`count(*)::int` }).from(openingBalances)
    .where(and(eq(openingBalances.tenantId, tenantId), eq(openingBalances.fyCode, code)));
  assertFiscalYearActivationAllowed({
    settings, targetCode: code, outgoing, periodRows, targetOpeningBalanceCount: cnt?.n ?? 0,
  });
  return { closing: outgoing.map((y: { code: string }) => y.code) };
}

export async function applyFiscalYearActivation(
  tx: Tx, meta: ActorMeta, p: { code: string; reason: string; requestId?: string },
): Promise<void> {
  await lockTenant(tx, "fy", meta.tenantId);
  const { closing } = await checkFiscalYearActivation(tx, meta.tenantId, p.code);
  await tx.update(fiscalYears).set({ status: "closed" })
    .where(and(eq(fiscalYears.tenantId, meta.tenantId), eq(fiscalYears.status, "active")));
  await tx.update(fiscalYears).set({ status: "active" })
    .where(and(eq(fiscalYears.tenantId, meta.tenantId), eq(fiscalYears.code, p.code)));
  await auditEvent(tx, meta, "activate_fiscal_year", "fiscal_year", p.code, {
    reason: p.reason, closedFiscalYears: closing, ...(p.requestId ? { changeRequestId: p.requestId } : {}),
  });
}

export type OpeningBalanceEntry = {
  id: string; accountCode: string; debitMinor: string | number; creditMinor: string | number; narration: string | null;
};

export async function applyOpeningBalances(
  tx: Tx, meta: ActorMeta, p: { id: string; fyCode: string; entries: OpeningBalanceEntry[]; reason: string; requestId?: string },
): Promise<void> {
  assertOpeningBalancesBalanced(p.entries);
  await lockTenant(tx, "ob", meta.tenantId);
  const codes = [...new Set(p.entries.map((e) => e.accountCode))];
  const existing = await tx.select({ accountCode: openingBalances.accountCode }).from(openingBalances)
    .where(and(eq(openingBalances.tenantId, meta.tenantId), eq(openingBalances.fyCode, p.fyCode), inArray(openingBalances.accountCode, codes)));
  if (existing.length > 0) {
    throw new DomainError(
      "OPENING_BALANCE_ALREADY_EXISTS",
      `an opening balance for account ${existing[0]?.accountCode} in FY ${p.fyCode} already exists`,
    );
  }
  for (const entry of p.entries) {
    const inserted = await tx.insert(openingBalances).values({
      id: entry.id, tenantId: meta.tenantId, fyCode: p.fyCode, accountCode: entry.accountCode,
      debitMinor: BigInt(entry.debitMinor), creditMinor: BigInt(entry.creditMinor),
      narration: entry.narration, enteredBy: meta.actorId,
    }).onConflictDoNothing().returning({ id: openingBalances.id });
    if (inserted.length === 0) {
      throw new DomainError(
        "OPENING_BALANCE_ALREADY_EXISTS",
        `an opening balance for account ${entry.accountCode} in FY ${p.fyCode} already exists`,
      );
    }
  }
  await auditEvent(tx, meta, "enter_opening_balances", "opening_balance", p.id, {
    fyCode: p.fyCode, entryCount: p.entries.length, reason: p.reason, ...(p.requestId ? { changeRequestId: p.requestId } : {}),
  });
}

export async function applyHoaChange(
  tx: Tx, meta: ActorMeta, p: { headId: string; hoaCode: string; reason: string; requestId?: string },
): Promise<{ headCode: string; oldHoaCode: string | null }> {
  const [head] = await tx.select().from(financeHeads)
    .where(and(eq(financeHeads.id, p.headId), eq(financeHeads.tenantId, meta.tenantId))).limit(1);
  if (!head) throw new DomainError("NOT_FOUND", "head not found");
  await tx.update(financeHeads).set({ hoaCode: p.hoaCode, updatedBy: meta.actorId, updatedAt: new Date() })
    .where(and(eq(financeHeads.id, p.headId), eq(financeHeads.tenantId, meta.tenantId)));
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: meta.tenantId, actorId: meta.actorId, correlationId: meta.correlationId,
    payload: {
      service: "finance", action: "head_hoa_changed", resourceType: "finance_head", resourceId: p.headId, outcome: "success",
      details: {
        headCode: head.code, oldHoaCode: head.hoaCode ?? null, newHoaCode: p.hoaCode, reason: p.reason,
        ...(p.requestId ? { changeRequestId: p.requestId } : {}),
      },
    },
  });
  return { headCode: head.code, oldHoaCode: head.hoaCode ?? null };
}

/** Upsert the per-tenant settings (shared by the direct update and the approved settings_relax request). */
export async function applySettingsChange(
  tx: Tx, meta: ActorMeta, p: { changes: Partial<FinanceSettings>; reason: string; requestId?: string },
): Promise<void> {
  const before = await loadSettingsTx(tx, meta.tenantId);
  const after = { ...before, ...p.changes };
  await tx.insert(financeSettings).values({ tenantId: meta.tenantId, ...after, updatedBy: meta.actorId })
    .onConflictDoUpdate({
      target: financeSettings.tenantId,
      set: { ...after, updatedBy: meta.actorId, updatedAt: new Date(), version: sql`${financeSettings.version} + 1` },
    });
  await auditEvent(tx, meta, "update_finance_settings", "finance_settings", meta.tenantId, {
    before, after, reason: p.reason, ...(p.requestId ? { changeRequestId: p.requestId } : {}),
  });
}
