import { tenantTransaction } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { dcbEntries } from "../assessment/schema.js";
import { assessees } from "../assessee/schema.js";
import { eq, and, sql } from "drizzle-orm";
import type { DcbOutstanding } from "./domain.js";

/** Minimal read handle a caller-supplied transaction must satisfy for the
 * `Tx` siblings below (TX-001) — reused across bbps repo functions that
 * need to route through an already-open outer transaction. */
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * Compute the total outstanding balance for an assessee from DCB entries.
 * Looks up the assessee by identifierNo, then sums DCB demand vs collection entries.
 */
export async function getDcbOutstanding(tenantId: string, assesseeIdentifier: string): Promise<DcbOutstanding | null> {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return getDcbOutstandingTx(t, tenantId, assesseeIdentifier);
  });
}

/**
 * TX-001 — tenant-scoped sibling of getDcbOutstanding(). Reads through a
 * caller-supplied transaction handle so an already-open db.transaction()
 * (bbps/consumer.ts's bbpsFetchBill and bbpsPayBill handlers, both of which
 * call this to price the bill/payment before writing) does not open a
 * second, bare tenantTransaction()/db.transaction() from inside itself:
 * under pool.max concurrent in-flight consumer transactions, the nested
 * call has no free connection to open on and deadlocks the pool silently.
 * Route every read that happens inside an already-open consumer
 * transaction through this, not getDcbOutstanding().
 */
export async function getDcbOutstandingTx(tx: Writer, tenantId: string, assesseeIdentifier: string): Promise<DcbOutstanding | null> {
  // Find assessee by identifier number
  const assesseeRows = await tx
    .select()
    .from(assessees)
    .where(and(eq(assessees.tenantId, tenantId), eq(assessees.identifierNo, assesseeIdentifier)))
    .limit(1);

  const assessee = assesseeRows[0];
  if (!assessee) return null;

  // Get total outstanding: sum of all balanceMinor from the latest DCB entry per demand
  // Simplified: get all DCB entries for this assessee and compute net outstanding
  const result = await tx
    .select({
      totalOutstanding: sql<bigint>`COALESCE(SUM(
        CASE WHEN ${dcbEntries.entryType} = 'demand' THEN ${dcbEntries.amountMinor}
             ELSE -${dcbEntries.amountMinor}
        END
      ), 0)`.mapWith({ mapFromDriverValue: (v: string) => BigInt(v) }),
      demandCount: sql<number>`COUNT(DISTINCT ${dcbEntries.demandId})`.mapWith(Number),
      oldestDueDate: sql<string>`MIN(${dcbEntries.createdAt})`.mapWith(String),
    })
    .from(dcbEntries)
    .where(and(eq(dcbEntries.tenantId, tenantId), eq(dcbEntries.assesseeId, assessee.id)));

  const row = result[0];
  const totalOutstandingMinor = row?.totalOutstanding ?? 0n;
  const demandCount = row?.demandCount ?? 0;
  const oldestDueDate = row?.oldestDueDate ?? new Date().toISOString();

  return {
    assesseeId: assessee.id,
    ownerName: assessee.ownerName,
    totalOutstandingMinor,
    oldestDueDate,
    demandCount,
  };
}
