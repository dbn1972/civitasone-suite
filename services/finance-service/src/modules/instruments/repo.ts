import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  financeInstruments,
  type InstrumentRow,
  type InstrumentInsert,
} from "../treasury/schema.js";

/**
 * Insert a new instrument. Idempotent on (tenant_id, instrument_type,
 * instrument_no): a re-issue of the same number returns the existing row rather
 * than creating a duplicate or erroring.
 */
export async function insertInstrument(row: InstrumentInsert): Promise<{ row: InstrumentRow; created: boolean }> {
  const inserted = await db
    .insert(financeInstruments)
    .values(row)
    .onConflictDoNothing({
      target: [financeInstruments.tenantId, financeInstruments.instrumentType, financeInstruments.instrumentNo],
    })
    .returning();
  if (inserted[0]) return { row: inserted[0], created: true };
  // Conflict — the instrument already exists; return the canonical row.
  const existing = await findByNumber(row.tenantId, row.instrumentType, row.instrumentNo);
  if (!existing) throw new Error("INSTRUMENT_INSERT_RACE: conflict but no existing row found");
  return { row: existing, created: false };
}

export async function findById(tenantId: string, id: string): Promise<InstrumentRow | null> {
  const rows = await db
    .select()
    .from(financeInstruments)
    .where(and(eq(financeInstruments.tenantId, tenantId), eq(financeInstruments.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findByNumber(tenantId: string, type: string, no: string): Promise<InstrumentRow | null> {
  const rows = await db
    .select()
    .from(financeInstruments)
    .where(and(
      eq(financeInstruments.tenantId, tenantId),
      eq(financeInstruments.instrumentType, type),
      eq(financeInstruments.instrumentNo, no),
    ))
    .limit(1);
  return rows[0] ?? null;
}

export async function listInstruments(
  tenantId: string,
  filters: { status?: string; type?: string; limit: number },
): Promise<InstrumentRow[]> {
  const conds = [eq(financeInstruments.tenantId, tenantId)];
  if (filters.status) conds.push(eq(financeInstruments.status, filters.status));
  if (filters.type)   conds.push(eq(financeInstruments.instrumentType, filters.type));
  return db
    .select()
    .from(financeInstruments)
    .where(and(...conds))
    .orderBy(desc(financeInstruments.issueDate), desc(financeInstruments.createdAt))
    .limit(filters.limit);
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
  const updated = await db
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
