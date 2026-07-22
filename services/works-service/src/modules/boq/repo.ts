import { eq, and } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { boqItems, recapitulation } from "./schema.js";

export async function listBoqItems(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(boqItems)
      .where(and(eq(boqItems.tenantId, tenantId), eq(boqItems.workId, workId)));
  });
}

export async function getRecapitulation(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(recapitulation)
      .where(and(eq(recapitulation.tenantId, tenantId), eq(recapitulation.workId, workId)));
    return rows[0] ?? null;
  });
}
