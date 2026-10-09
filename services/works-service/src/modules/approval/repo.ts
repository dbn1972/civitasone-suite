import { eq, and, desc, count } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { administrativeApprovals, technicalSanctions } from "./schema.js";

/** Tenant-wide AA count — GAP2-WORKS-APPROVALS-05 true register total. */
export async function countAa(tenantId: string): Promise<number> {
  return scopedRead(async (tx) => {
    const rows = await tx.select({ value: count() }).from(administrativeApprovals)
      .where(eq(administrativeApprovals.tenantId, tenantId));
    return Number(rows[0]?.value ?? 0);
  });
}

/** Tenant-wide TS count — GAP2-WORKS-APPROVALS-05 true register total. */
export async function countTs(tenantId: string): Promise<number> {
  return scopedRead(async (tx) => {
    const rows = await tx.select({ value: count() }).from(technicalSanctions)
      .where(eq(technicalSanctions.tenantId, tenantId));
    return Number(rows[0]?.value ?? 0);
  });
}

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

/** BR-013 input: does a FINALIZED technical sanction exist for this work? */
export async function hasFinalizedTsForWork(tenantId: string, workId: string): Promise<boolean> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(technicalSanctions)
      .where(and(
        eq(technicalSanctions.tenantId, tenantId),
        eq(technicalSanctions.workId, workId),
        eq(technicalSanctions.status, "finalized"),
      ))
      .limit(1);
    return rows.length > 0;
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

/** Tenant-wide AA register, newest first — backs the FE approvals list page. */
export async function listAa(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    return tx.select().from(administrativeApprovals)
      .where(eq(administrativeApprovals.tenantId, tenantId))
      .orderBy(desc(administrativeApprovals.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}

/** Tenant-wide TS register, newest first — backs the FE approvals list page. */
export async function listTs(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    return tx.select().from(technicalSanctions)
      .where(eq(technicalSanctions.tenantId, tenantId))
      .orderBy(desc(technicalSanctions.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}
