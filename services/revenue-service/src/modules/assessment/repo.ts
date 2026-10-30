/**
 * Assessment module — cache-first reads (repo layer).
 *
 * _Requirements: SVC-131, Requirement 6_
 */
import { tenantTransaction } from "@civitasone/db";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { assessments, demands, dcbEntries, remissions } from "./schema.js";
import { eq, and, inArray } from "drizzle-orm";
import { SERVICE } from "../../topics.js";
import { computeDcbSummary, dcbBalanceEffect, type DcbEntry } from "./domain.js";
import { getAssesseeOutstanding } from "../arrears/outstanding.js";

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

/**
 * UAT B8-F68 (P1 accept-nonexistent): uncached, tenant-scoped existence read used by the
 * remit / remit-decide commands before publishing (RLS-safe: runs in the tenant context).
 */
export async function assessmentExists(tenantId: string, id: string): Promise<boolean> {
  const rows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t
      .select({ id: assessments.id })
      .from(assessments)
      .where(and(eq(assessments.tenantId, tenantId), eq(assessments.id, id)))
      .limit(1);
  });
  return rows.length > 0;
}

export async function listAssessments(tenantId: string, pagination: { limit: number; offset: number }) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:assessments`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t.select().from(assessments).where(eq(assessments.tenantId, tenantId));
    });
  });
  const items = rows ?? [];

  // Fast path: nothing to enrich.
  if (items.length === 0) {
    return { data: [], total: 0 };
  }

  // Page FIRST, then enrich only the page: remissions are fetched for the
  // page assessment ids, never for the whole tenant.
  const total = items.length;
  const pageItems = items.slice(pagination.offset, pagination.offset + pagination.limit);
  if (pageItems.length === 0) {
    return { data: [], total };
  }

  // GAP-REVENUE-ASSESSMENTS-01: surface the latest remission's status + the
  // officer who requested it on each assessment row, so the UI can pre-disable
  // Approve/Reject on rows with no pending remission or that the same officer
  // raised. Read fresh (NOT cached with the assessments list) so a just-raised
  // or just-decided remission is reflected immediately. Same `assessment`
  // module schema as assessments — no cross-module/cross-service join.
  const remissionRows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t
      .select({
        assessmentId: remissions.assessmentId,
        status: remissions.status,
        makerUserId: remissions.makerUserId,
        createdAt: remissions.createdAt,
      })
      .from(remissions)
      .where(and(
        eq(remissions.tenantId, tenantId),
        inArray(remissions.assessmentId, pageItems.map((a) => a.id)),
      ));
  });

  // Newest remission per assessment wins. Sort in JS (not SQL ORDER BY) so this
  // stays robust across the repo's unit-test DB mocks and the live driver alike.
  const sorted = [...(remissionRows ?? [])].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt as unknown as string).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt as unknown as string).getTime() : 0;
    return tb - ta;
  });
  const latestByAssessment = new Map<string, { status: string; makerUserId: string }>();
  for (const r of sorted) {
    if (!latestByAssessment.has(r.assessmentId)) {
      latestByAssessment.set(r.assessmentId, { status: r.status, makerUserId: r.makerUserId });
    }
  }

  const data = pageItems.map((a) => {
    const rem = latestByAssessment.get(a.id);
    return {
      ...a,
      remissionStatus: rem?.status ?? "none",
      remissionRequestedBy: rem?.makerUserId ?? null,
    };
  });

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

    const { totalDemand, totalCollection, balance } = computeDcbSummary(entries as DcbEntry[]);

    // The figure the instalment/arrears consumers actually plan against
    // (sum of the latest running balance per demand), so a screen can show
    // exactly what the service will use rather than re-deriving it.
    const outstanding = await tenantTransaction(db, tenantId, async (tx) =>
      getAssesseeOutstanding(tx, tenantId, assesseeId),
    );

    return {
      totalDemand: totalDemand.toString(),
      totalCollected: totalCollection.toString(),
      balance: balance.toString(),
      outstandingMinor: outstanding.toString(),
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
    balance += dcbBalanceEffect(entry);
  }

  return balance;
}

/** The pending remission (if any) for an assessment, tenant-scoped. */
export async function findPendingRemission(tenantId: string, assessmentId: string) {
  const rows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t
      .select()
      .from(remissions)
      .where(
        and(
          eq(remissions.tenantId, tenantId),
          eq(remissions.assessmentId, assessmentId),
          eq(remissions.status, "pending"),
        ),
      )
      .limit(1);
  });
  return rows[0] ?? null;
}
