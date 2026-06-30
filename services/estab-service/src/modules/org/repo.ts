import { eq, and, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabOrgUnit } from "./schema.js";
import type { OrgUnitRow, OrgUnitInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findOrgUnitById(id: string, tenantId: string): Promise<OrgUnitRow | null> {
  const rows = await db.select().from(estabOrgUnit)
    .where(and(eq(estabOrgUnit.id, id), eq(estabOrgUnit.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findOrgUnitByIdTx(tx: Writer, id: string, tenantId: string): Promise<OrgUnitRow | null> {
  const rows = await (tx as typeof db).select().from(estabOrgUnit)
    .where(and(eq(estabOrgUnit.id, id), eq(estabOrgUnit.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findOrgUnitByCode(tenantId: string, code: string): Promise<OrgUnitRow | null> {
  const rows = await db.select().from(estabOrgUnit)
    .where(and(eq(estabOrgUnit.tenantId, tenantId), eq(estabOrgUnit.code, code))).limit(1);
  return rows[0] ?? null;
}

export async function listOrgUnits(tenantId: string, limit: number): Promise<OrgUnitRow[]> {
  return db.select().from(estabOrgUnit)
    .where(eq(estabOrgUnit.tenantId, tenantId))
    .orderBy(asc(estabOrgUnit.type), asc(estabOrgUnit.code))
    .limit(limit);
}

/** Walk parent links to the root, returning ancestors nearest-first. */
export async function listAncestors(tenantId: string, id: string): Promise<OrgUnitRow[]> {
  const out: OrgUnitRow[] = [];
  let cursor: string | null = id;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node: OrgUnitRow | null = await findOrgUnitById(cursor, tenantId);
    if (!node) break;
    if (node.id !== id) out.push(node);
    cursor = node.parentId;
  }
  return out;
}

export async function insertOrgUnit(tx: Writer, row: OrgUnitInsert): Promise<void> {
  await tx.insert(estabOrgUnit).values(row);
}

export async function updateOrgUnit(tx: Writer, id: string, patch: Partial<OrgUnitInsert>): Promise<void> {
  await tx.update(estabOrgUnit).set({ ...patch, updatedAt: new Date() }).where(eq(estabOrgUnit.id, id));
}
