/**
 * Assessment module — cache-first reads (repo layer).
 *
 * _Requirements: SVC-131, Requirement 6_
 */
import { tenantTransaction } from "@civitasone/db";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { assessments, demands, dcbEntries } from "./schema.js";
import { eq, and } from "drizzle-orm";
import { SERVICE } from "../../topics.js";

export async function findAssessment(tenantId: string, id: string) {
  const rows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t
      .select()
      .from(assessments)
      .where(and(eq(assessments.tenantId, tenantId), eq(assessments.id, id)));
  });
  return rows[0] ?? null;
}

export async function listAssessments(tenantId: string, pagination: { limit: number; offset: number }) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:assessments`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t.select().from(assessments).where(eq(assessments.tenantId, tenantId));
    });
  });
  const items = rows ?? [];
  const total = items.length;
  const data = items.slice(pagination.offset, pagination.offset + pagination.limit);
  return { data, total };
}

export async function listDemands(tenantId: string, assesseeId: string) {
  return cache.getOrLoad(`${SERVICE}:${tenantId}:demands:${assesseeId}`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t
        .select()
        .from(demands)
        .where(and(eq(demands.tenantId, tenantId), eq(demands.assesseeId, assesseeId)));
    });
  });
}


export async function listAllDemands(tenantId: string, pagination: { limit: number; offset: number }) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:demands:all`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t.select().from(demands).where(eq(demands.tenantId, tenantId));
    });
  });
  const all = rows ?? [];
  return {
    data: all.slice(pagination.offset, pagination.offset + pagination.limit),
    meta: { total: all.length },
  };
}
export async function getDcbSummary(tenantId: string, assesseeId: string) {
  return cache.getOrLoad(`${SERVICE}:${tenantId}:dcb:${assesseeId}`, async () => {
    const entries = await tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t
        .select()
        .from(dcbEntries)
        .where(and(eq(dcbEntries.tenantId, tenantId), eq(dcbEntries.assesseeId, assesseeId)));
    });

    let totalDemand = 0n;
    let totalCollected = 0n;

    for (const entry of entries) {
      if (entry.entryType === "demand") {
        totalDemand += entry.amountMinor;
      } else {
        totalCollected += entry.amountMinor;
      }
    }

    return {
      totalDemand: totalDemand.toString(),
      totalCollected: totalCollected.toString(),
      balance: (totalDemand - totalCollected).toString(),
    };
  });
}

export async function getDemandBalance(tenantId: string, demandId: string) {
  const entries = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t
      .select()
      .from(dcbEntries)
      .where(and(eq(dcbEntries.tenantId, tenantId), eq(dcbEntries.demandId, demandId)));
  });

  let balance = 0n;
  for (const entry of entries) {
    if (entry.entryType === "demand") {
      balance += entry.amountMinor;
    } else {
      balance -= entry.amountMinor;
    }
  }

  return balance;
}
