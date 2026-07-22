import { eq, and } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import * as s from "./schema.js";

type TableType = typeof s.authorities | typeof s.workTypes | typeof s.workSubTypes |
  typeof s.proposerTypes | typeof s.programs | typeof s.publicationLevels |
  typeof s.repairTypes | typeof s.schemes | typeof s.scopes |
  typeof s.tenderTypes | typeof s.userDepartments | typeof s.contractorClasses |
  typeof s.issueTypes | typeof s.issueDescriptionTypes | typeof s.assets |
  typeof s.workDescriptionTypes | typeof s.srItems;

export async function listMaster(table: TableType, tenantId: string, page: number, pageSize: number) {
  return cache.getOrLoad(`works:${tenantId}:master:${table._.name}:${page}:${pageSize}`, async () => {
    return scopedRead(async (tx) => {
      const rows = await tx.select().from(table)
        .where(eq(table.tenantId, tenantId))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return rows;
    });
  });
}

export async function getMaster(table: TableType, tenantId: string, id: string) {
  return cache.getOrLoad(`works:${tenantId}:master:${table._.name}:${id}`, async () => {
    return scopedRead(async (tx) => {
      const rows = await tx.select().from(table)
        .where(and(eq(table.id, id), eq(table.tenantId, tenantId)));
      return rows[0] ?? null;
    });
  });
}
