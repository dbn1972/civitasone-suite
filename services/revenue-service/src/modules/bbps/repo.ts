import { tenantTransaction } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { dcbEntries } from "../assessment/schema.js";
import { assessees } from "../assessee/schema.js";
import { eq, and, sql } from "drizzle-orm";
import type { DcbOutstanding } from "./domain.js";

/**
 * Compute the total outstanding balance for an assessee from DCB entries.
 * Looks up the assessee by identifierNo, then sums DCB demand vs collection entries.
 */
export async function getDcbOutstanding(tenantId: string, assesseeIdentifier: string): Promise<DcbOutstanding | null> {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;

    // Find assessee by identifier number
    const assesseeRows = await t
      .select()
      .from(assessees)
      .where(and(eq(assessees.tenantId, tenantId), eq(assessees.identifierNo, assesseeIdentifier)))
      .limit(1);

    const assessee = assesseeRows[0];
    if (!assessee) return null;

    // Get total outstanding: sum of all balanceMinor from the latest DCB entry per demand
    // Simplified: get all DCB entries for this assessee and compute net outstanding
    const result = await t
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
  });
}
