import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { lastFourDigits } from "./account-mask.js";

export type Writer = Pick<typeof db, "select" | "insert" | "update">;
import {
  financeInstruments,
  financeBanks,
  type InstrumentRow,
  type InstrumentInsert,
} from "../treasury/schema.js";

/**
 * Insert a new instrument. Idempotent on (tenant_id, instrument_type,
 * instrument_no): a re-issue of the same number returns the existing row rather
 * than creating a duplicate or erroring.
 */
export async function insertInstrument(row: InstrumentInsert): Promise<{ row: InstrumentRow; created: boolean }> {
  return db.transaction((tx) => insertInstrumentTx(tx, row));
}

/** Tx-scoped twin of insertInstrument for callers already inside an open transaction. */
export async function insertInstrumentTx(tx: Writer, row: InstrumentInsert): Promise<{ row: InstrumentRow; created: boolean }> {
  const inserted = await tx
    .insert(financeInstruments)
    .values(row)
    .onConflictDoNothing({
      target: [financeInstruments.tenantId, financeInstruments.instrumentType, financeInstruments.instrumentNo],
    })
    .returning();
  if (inserted[0]) return { row: inserted[0], created: true };
  const existing = await tx
    .select()
    .from(financeInstruments)
    .where(and(
      eq(financeInstruments.tenantId, row.tenantId),
      eq(financeInstruments.instrumentType, row.instrumentType),
      eq(financeInstruments.instrumentNo, row.instrumentNo),
    ))
    .limit(1);
  if (!existing[0]) throw new Error("INSTRUMENT_INSERT_RACE: conflict but no existing row found");
  return { row: existing[0], created: false };
}

/** Who issued the instrument (its creator), read inside the caller's transaction; null when it does not exist. */
export async function findIssuerTx(tx: Writer, tenantId: string, id: string): Promise<string | null> {
  const rows = await tx.select({ createdBy: financeInstruments.createdBy }).from(financeInstruments)
    .where(and(eq(financeInstruments.tenantId, tenantId), eq(financeInstruments.id, id))).limit(1);
  return rows[0]?.createdBy ?? null;
}

export async function findById(tenantId: string, id: string): Promise<InstrumentRow | null> {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(financeInstruments)
      .where(and(eq(financeInstruments.tenantId, tenantId), eq(financeInstruments.id, id)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export async function findByNumber(tenantId: string, type: string, no: string): Promise<InstrumentRow | null> {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(financeInstruments)
      .where(and(
        eq(financeInstruments.tenantId, tenantId),
        eq(financeInstruments.instrumentType, type),
        eq(financeInstruments.instrumentNo, no),
      ))
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * Last four digits of each referenced bank account, keyed by bank id
 * (GAP-FINANCE-TREASURY-CHEQUES-05). Tenant-scoped; the full account number
 * never leaves this function.
 */
export async function accountLast4ByBankId(tenantId: string, bankIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (bankIds.length === 0) return out;
  const rows = await scopedRead((tx) => tx
    .select({ id: financeBanks.id, accountNo: financeBanks.accountNo })
    .from(financeBanks)
    .where(and(eq(financeBanks.tenantId, tenantId), inArray(financeBanks.id, bankIds))));
  for (const r of rows) {
    const last4 = lastFourDigits(r.accountNo);
    if (last4) out.set(r.id, last4);
  }
  return out;
}

export async function listInstruments(
  tenantId: string,
  filters: { status?: string; type?: string; limit: number },
): Promise<InstrumentRow[]> {
  return scopedRead(async (tx) => {
    const conds = [eq(financeInstruments.tenantId, tenantId)];
    if (filters.status) conds.push(eq(financeInstruments.status, filters.status));
    if (filters.type)   conds.push(eq(financeInstruments.instrumentType, filters.type));
    return tx
      .select()
      .from(financeInstruments)
      .where(and(...conds))
      .orderBy(desc(financeInstruments.issueDate), desc(financeInstruments.createdAt))
      .limit(filters.limit);
  });
}

/**
 * Atomic guarded status transition. The WHERE pins both the id AND the required
 * source status, so the update only fires when the instrument is in a legal
 * predecessor state. Returns the updated row, or null when the guard did not
 * match (caller maps that to a 409 conflict — already in that state, or an
 * illegal transition). This makes every transition idempotent and race-safe.
 */
export async function transition(
  tenantId: string,
  id: string,
  fromStatuses: string[],
  toStatus: string,
  patch: Partial<Pick<InstrumentRow, "bounceReason">>,
  tsColumn: "presentedAt" | "clearedAt" | "bouncedAt" | "cancelledAt",
  updatedBy: string,
): Promise<InstrumentRow | null> {
  return db.transaction((tx) => transitionTx(tx, tenantId, id, fromStatuses, toStatus, patch, tsColumn, updatedBy));
}

/** Tx-scoped twin of transition for callers already inside an open transaction. */
export async function transitionTx(
  tx: Writer,
  tenantId: string,
  id: string,
  fromStatuses: string[],
  toStatus: string,
  patch: Partial<Pick<InstrumentRow, "bounceReason">>,
  tsColumn: "presentedAt" | "clearedAt" | "bouncedAt" | "cancelledAt",
  updatedBy: string,
): Promise<InstrumentRow | null> {
  const updated = await tx
    .update(financeInstruments)
    .set({
      status: toStatus,
      [tsColumn]: new Date(),
      updatedBy,
      updatedAt: new Date(),
      version: sql`${financeInstruments.version} + 1`,
      ...(patch.bounceReason !== undefined ? { bounceReason: patch.bounceReason } : {}),
    })
    .where(and(
      eq(financeInstruments.tenantId, tenantId),
      eq(financeInstruments.id, id),
      inArray(financeInstruments.status, fromStatuses),
    ))
    .returning();
  return updated[0] ?? null;
}
