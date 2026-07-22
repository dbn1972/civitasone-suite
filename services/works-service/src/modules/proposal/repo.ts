import { eq, and } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { workProposals, workSplits, workCoaMappings, workOfficeMappings } from "./schema.js";

export async function getProposal(tenantId: string, id: string) {
  return cache.getOrLoad(`works:${tenantId}:proposal:${id}`, async () => {
    return scopedRead(async (tx) => {
      const rows = await tx.select().from(workProposals)
        .where(and(eq(workProposals.id, id), eq(workProposals.tenantId, tenantId)));
      return rows[0] ?? null;
    });
  });
}

export async function listProposals(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    return tx.select().from(workProposals)
      .where(eq(workProposals.tenantId, tenantId))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}

export async function listSplits(tenantId: string, parentWorkId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(workSplits)
      .where(and(eq(workSplits.tenantId, tenantId), eq(workSplits.parentWorkId, parentWorkId)));
  });
}

export async function listCoaMappings(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(workCoaMappings)
      .where(and(eq(workCoaMappings.tenantId, tenantId), eq(workCoaMappings.workId, workId)));
  });
}

export async function listOfficeMappings(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(workOfficeMappings)
      .where(and(eq(workOfficeMappings.tenantId, tenantId), eq(workOfficeMappings.workId, workId)));
  });
}
