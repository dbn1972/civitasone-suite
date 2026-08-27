import { eq, and, getTableName } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import * as s from "./schema.js";

type TableType = typeof s.authorities | typeof s.workTypes | typeof s.workSubTypes |
  typeof s.proposerTypes | typeof s.programs | typeof s.publicationLevels |
  typeof s.repairTypes | typeof s.schemes | typeof s.scopes |
  typeof s.tenderTypes | typeof s.userDepartments | typeof s.contractorClasses |
  typeof s.issueTypes | typeof s.issueDescriptionTypes | typeof s.assets |
  typeof s.workDescriptionTypes | typeof s.srItems;

// Bug fix (works-masters-deep-verify, CRITICAL): this used `table._.name`,
// drizzle-orm's internal accessor, which is undefined on the installed
// drizzle-orm@0.30 table proxy — every call threw `TypeError: Cannot read
// properties of undefined (reading 'name')`, so listMaster/getMaster (and
// therefore the ENTIRE /works/masters/* read surface, all 17 master types)
// 500'd unconditionally. masters/consumer.ts already carries the fix and a
// comment about it (`getTableName`, not `table._.name`) — that fix was never
// mirrored here. Use the same public API.
export async function listMaster(table: TableType, tenantId: string, page: number, pageSize: number) {
  return cache.getOrLoad(`works:${tenantId}:master:${getTableName(table)}:${page}:${pageSize}`, async () => {
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
  return cache.getOrLoad(`works:${tenantId}:master:${getTableName(table)}:${id}`, async () => {
    return scopedRead(async (tx) => {
      const rows = await tx.select().from(table)
        .where(and(eq(table.id, id), eq(table.tenantId, tenantId)));
      return rows[0] ?? null;
    });
  });
}
