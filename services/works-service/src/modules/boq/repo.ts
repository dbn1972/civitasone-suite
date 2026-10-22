import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { boqItems, recapitulation } from "./schema.js";
import { workProposals } from "../proposal/schema.js";

export async function listBoqItems(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(boqItems)
      .where(and(eq(boqItems.tenantId, tenantId), eq(boqItems.workId, workId)));
  });
}

export async function getBoqItemById(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(boqItems)
      .where(and(eq(boqItems.tenantId, tenantId), eq(boqItems.id, id)));
    return rows[0] ?? null;
  });
}

/** Batch lookup — avoids N+1 when pricing a set of measurement lines (e.g.
 * computing a bill's measured value from every measurement under an MB). */
export async function listBoqItemsByIds(tenantId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return scopedRead(async (tx) => {
    return tx.select().from(boqItems)
      .where(and(eq(boqItems.tenantId, tenantId), inArray(boqItems.id, ids)));
  });
}

/**
 * GAP-WORKS-BOQ-NEW-04: the code/description of every line already on a work, for the synchronous BR-016 duplicate
 * pre-check on POST /v1/works/boq (the consumer re-checks inside its own transaction).
 */
export async function listBoqLineRefs(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx.select({
      workId: boqItems.workId,
      itemCode: boqItems.itemCode,
      itemDescription: boqItems.itemDescription,
    }).from(boqItems)
      .where(and(eq(boqItems.tenantId, tenantId), eq(boqItems.workId, workId)));
  });
}

/**
 * GAP-WORKS-BOQ-WORKID-05: number of BoQ lines on a work and the paise-exact sum of their amounts. This is the "work
 * amount" a recapitulation is computed on: it is read from the stored lines, never taken from the client.
 */
export async function boqWorkTotals(tenantId: string, workId: string): Promise<{ lines: number; totalMinor: bigint }> {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select({
        lines: sql<number>`cast(count(*) as int)`,
        totalMinor: sql<string>`coalesce(sum(${boqItems.amountMinor}), 0)::text`,
      })
      .from(boqItems)
      .where(and(eq(boqItems.tenantId, tenantId), eq(boqItems.workId, workId)));
    return { lines: rows[0]?.lines ?? 0, totalMinor: BigInt(rows[0]?.totalMinor ?? "0") };
  });
}

export async function getRecapitulation(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(recapitulation)
      .where(and(eq(recapitulation.tenantId, tenantId), eq(recapitulation.workId, workId)));
    return rows[0] ?? null;
  });
}

/**
 * Tenant-wide BoQ index (all works), newest first — backs the FE BoQ list page.
 *
 * GAP-WORKS-BOQ-01: left-joins work_proposals (same `works` schema — the exact
 * pattern listClosures already uses) so each row carries the human workNumber,
 * letting the list show which work a line belongs to instead of only an opaque
 * scope UUID. srItemId is already a column on boq_items and is selected here so
 * the FE can tell SR-linked lines from free-typed ones (GAP-WORKS-BOQ-04).
 */
export async function listAllBoqItems(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    return tx
      .select({
        id: boqItems.id,
        workId: boqItems.workId,
        workNumber: workProposals.workNumber,
        srItemId: boqItems.srItemId,
        itemType: boqItems.itemType,
        itemDescription: boqItems.itemDescription,
        itemCode: boqItems.itemCode,
        unit: boqItems.unit,
        rate: boqItems.rate,
        quantity: boqItems.quantity,
        scopeId: boqItems.scopeId,
        remarks: boqItems.remarks,
        amountMinor: boqItems.amountMinor,
        version: boqItems.version,
        createdAt: boqItems.createdAt,
      })
      .from(boqItems)
      .leftJoin(workProposals, eq(workProposals.id, boqItems.workId))
      .where(eq(boqItems.tenantId, tenantId))
      .orderBy(desc(boqItems.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}

/**
 * GAP-WORKS-BOQ-02: exact tenant-wide BoQ line count + sum of amounts, so the
 * list page's stat cards (Total Items / Total Amount) reflect the FULL set,
 * not just the page the FE happened to fetch. Sum is done in SQL over bigint
 * paise and returned as a string (never a float) for formatMoney().
 */
export async function boqIndexSummary(
  tenantId: string,
): Promise<{ total: number; totalAmountMinor: string }> {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select({
        total: sql<number>`cast(count(*) as int)`,
        totalAmountMinor: sql<string>`coalesce(sum(${boqItems.amountMinor}), 0)::text`,
      })
      .from(boqItems)
      .where(eq(boqItems.tenantId, tenantId));
    return {
      total: rows[0]?.total ?? 0,
      totalAmountMinor: rows[0]?.totalAmountMinor ?? "0",
    };
  });
}
