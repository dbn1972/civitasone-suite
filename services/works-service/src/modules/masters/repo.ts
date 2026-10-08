import { eq, and, getTableName, ilike, or, desc } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import * as s from "./schema.js";

type TableType = typeof s.authorities | typeof s.workTypes | typeof s.workSubTypes |
  typeof s.proposerTypes | typeof s.programs | typeof s.publicationLevels |
  typeof s.repairTypes | typeof s.schemes | typeof s.scopes |
  typeof s.tenderTypes | typeof s.userDepartments | typeof s.contractorClasses |
  typeof s.issueTypes | typeof s.issueDescriptionTypes | typeof s.assets |
  typeof s.workDescriptionTypes | typeof s.srItems | typeof s.divisions;

// Bug fix (works-masters-deep-verify, CRITICAL): this used `table._.name`,
// drizzle-orm's internal accessor, which is undefined on the installed
// drizzle-orm@0.30 table proxy — every call threw `TypeError: Cannot read
// properties of undefined (reading 'name')`, so listMaster/getMaster (and
// therefore the ENTIRE /works/masters/* read surface, all 17 master types)
// 500'd unconditionally. masters/consumer.ts already carries the fix and a
// comment about it (`getTableName`, not `table._.name`) — that fix was never
// mirrored here. Use the same public API.
/** Escape LIKE wildcards so a search for 100% or a_b is literal. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

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

/**
 * GAP-WORKS-BOQ-NEW-01: typeahead search over the Schedule of Rates master
 * (works.sr_items) for the BoQ "Add item" SR picker. Matches the trimmed query
 * against item code or description (case-insensitive), active items only,
 * returning the canonical code/unit/rate so the FE can prefill them and send a
 * real srItemId instead of letting a clerk free-type a code/unit/rate that
 * drifts from the approved SR. Empty query returns the first `limit` active
 * items so the picker is useful before the user types.
 */
export async function searchSrItems(tenantId: string, query: string, limit = 20) {
  const q = query.trim();
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  return scopedRead(async (tx) => {
    const conditions = [eq(s.srItems.tenantId, tenantId), eq(s.srItems.active, true)];
    if (q.length > 0) {
      const like = `%${escapeLike(q)}%`;
      const match = or(ilike(s.srItems.itemCode, like), ilike(s.srItems.description, like));
      if (match) conditions.push(match);
    }
    return tx
      .select({
        id: s.srItems.id,
        itemCode: s.srItems.itemCode,
        description: s.srItems.description,
        unit: s.srItems.unit,
        rate: s.srItems.rate,
        zone: s.srItems.zone,
        srYear: s.srItems.srYear,
      })
      .from(s.srItems)
      .where(and(...conditions))
      .orderBy(desc(s.srItems.srYear), s.srItems.itemCode)
      .limit(safeLimit);
  });
}

/**
 * GAP-WORKS-REPORTS-01: typeahead search over the works division master
 * (works.divisions) for the reports division picker. Matches the trimmed query
 * against division name or code (case-insensitive), active divisions only,
 * returning {id, name, code} so the FE can resolve a seeded id's label and send
 * the real division uuid as ?divisionId= instead of letting a user free-type a
 * code that silently returns an empty register. Empty query returns the first
 * `limit` active divisions so the picker is useful before the user types.
 */
export async function searchDivisions(tenantId: string, query: string, limit = 20) {
  const q = query.trim();
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  return scopedRead(async (tx) => {
    const conditions = [eq(s.divisions.tenantId, tenantId), eq(s.divisions.active, true)];
    if (q.length > 0) {
      const like = `%${escapeLike(q)}%`;
      const match = or(ilike(s.divisions.name, like), ilike(s.divisions.code, like));
      if (match) conditions.push(match);
    }
    return tx
      .select({
        id: s.divisions.id,
        name: s.divisions.name,
        code: s.divisions.code,
        officeType: s.divisions.officeType,
      })
      .from(s.divisions)
      .where(and(...conditions))
      .orderBy(s.divisions.name)
      .limit(safeLimit);
  });
}
