import { eq, and, desc } from "drizzle-orm";
import { workProposals } from "../proposal/schema.js";
import { scopedRead } from "../../shared/db.js";
import { tenders, quotations, awards } from "./schema.js";

export async function hasTenderForWork(tenantId: string, workId: string): Promise<boolean> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(tenders)
      .where(and(eq(tenders.tenantId, tenantId), eq(tenders.workId, workId)))
      .limit(1);
    return rows.length > 0;
  });
}

export async function getAward(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(awards)
      .where(and(eq(awards.tenantId, tenantId), eq(awards.workId, workId)));
    return rows[0] ?? null;
  });
}

export async function listQuotations(tenantId: string, tenderId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(quotations)
      .where(and(eq(quotations.tenantId, tenantId), eq(quotations.tenderId, tenderId)));
  });
}

export async function getAwardById(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(awards)
      .where(and(eq(awards.tenantId, tenantId), eq(awards.id, id)))
      .limit(1);
    return rows[0] ?? null;
  });
}

/** Tenant-wide tender register (post pre-tender stage), newest first — backs the FE tenders list page. */
export async function listTenders(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    return tx
      .select({
        id: tenders.id,
        tenantId: tenders.tenantId,
        workId: tenders.workId,
        tenderTypeId: tenders.tenderTypeId,
        tenderAmountMinor: tenders.tenderAmountMinor,
        openingDate: tenders.openingDate,
        approvingAuthorityId: tenders.approvingAuthorityId,
        contractorClassId: tenders.contractorClassId,
        remarks: tenders.remarks,
        createdAt: tenders.createdAt,
        workNumber: workProposals.workNumber,
      })
      .from(tenders)
      .leftJoin(workProposals, eq(workProposals.id, tenders.workId))
      .where(eq(tenders.tenantId, tenantId))
      .orderBy(desc(tenders.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}
