import { eq, and, desc, inArray } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { boqItems, recapitulation } from "./schema.js";

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

export async function getRecapitulation(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(recapitulation)
      .where(and(eq(recapitulation.tenantId, tenantId), eq(recapitulation.workId, workId)));
    return rows[0] ?? null;
  });
}

/** Tenant-wide BoQ index (all works), newest first — backs the FE BoQ list page. */
export async function listAllBoqItems(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    return tx.select().from(boqItems)
      .where(eq(boqItems.tenantId, tenantId))
      .orderBy(desc(boqItems.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}
