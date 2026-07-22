import { eq, and } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { administrativeApprovals, technicalSanctions } from "./schema.js";

export async function countAaForWork(tenantId: string, workId: string): Promise<number> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(administrativeApprovals)
      .where(and(eq(administrativeApprovals.tenantId, tenantId), eq(administrativeApprovals.workId, workId)));
    return rows.length;
  });
}

export async function countTsForWork(tenantId: string, workId: string): Promise<number> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(technicalSanctions)
      .where(and(eq(technicalSanctions.tenantId, tenantId), eq(technicalSanctions.workId, workId)));
    return rows.length;
  });
}

export async function getAa(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(administrativeApprovals)
      .where(and(eq(administrativeApprovals.id, id), eq(administrativeApprovals.tenantId, tenantId)));
    return rows[0] ?? null;
  });
}

export async function getTs(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(technicalSanctions)
      .where(and(eq(technicalSanctions.id, id), eq(technicalSanctions.tenantId, tenantId)));
    return rows[0] ?? null;
  });
}
