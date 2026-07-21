import { and, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { administrativeUnits, type AdministrativeUnitRow, type AdministrativeUnitInsert, type AdministrativeUnitView } from "./schema.js";

function toView(r: AdministrativeUnitRow): AdministrativeUnitView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    code: r.code,
    name: r.name,
    type: r.type,
    parentId: r.parentId,
    population: r.population,
    areaKm2: r.areaKm2,
    pinCodes: r.pinCodes as string[] | null,
    lgdCode: r.lgdCode,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<AdministrativeUnitView | null> {
  const rows = await scopedRead((tx) => tx.select().from(administrativeUnits).where(eq(administrativeUnits.id, id)).limit(1));
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listAllByTenant(tenantId: string): Promise<AdministrativeUnitView[]> {
  const rows = await scopedRead((tx) => tx.select().from(administrativeUnits)
    .where(eq(administrativeUnits.tenantId, tenantId)));
  return rows.map(toView);
}

export async function findChildren(parentId: string, tenantId: string): Promise<AdministrativeUnitView[]> {
  const rows = await scopedRead((tx) => tx.select().from(administrativeUnits)
    .where(and(eq(administrativeUnits.parentId, parentId), eq(administrativeUnits.tenantId, tenantId))));
  return rows.map(toView);
}

/** Walk up the tree to find all ancestors of a given unit. */
export async function findAncestors(id: string, tenantId: string): Promise<AdministrativeUnitView[]> {
  const all = await listAllByTenant(tenantId);
  const byId = new Map(all.map((u) => [u.id, u]));
  const ancestors: AdministrativeUnitView[] = [];
  let current = byId.get(id);
  const visited = new Set<string>();
  while (current?.parentId && !visited.has(current.parentId)) {
    visited.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    ancestors.push(parent);
    current = parent;
  }
  return ancestors;
}

/** Walk down the tree to find all descendants of a given unit. */
export async function findDescendants(id: string, tenantId: string): Promise<AdministrativeUnitView[]> {
  const all = await listAllByTenant(tenantId);
  const childrenMap = new Map<string, AdministrativeUnitView[]>();
  for (const u of all) {
    if (u.parentId) {
      const siblings = childrenMap.get(u.parentId) ?? [];
      siblings.push(u);
      childrenMap.set(u.parentId, siblings);
    }
  }
  const descendants: AdministrativeUnitView[] = [];
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const children = childrenMap.get(current) ?? [];
    for (const child of children) {
      descendants.push(child);
      stack.push(child.id);
    }
  }
  return descendants;
}

/** Find siblings (same parent, same tenant, excluding self). */
export async function findSiblings(id: string, tenantId: string): Promise<AdministrativeUnitView[]> {
  const unit = await findById(id, tenantId);
  if (!unit) return [];
  if (!unit.parentId) {
    // Siblings are other roots
    const all = await listAllByTenant(tenantId);
    return all.filter((u) => !u.parentId && u.id !== id);
  }
  const children = await findChildren(unit.parentId, tenantId);
  return children.filter((u) => u.id !== id);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: AdministrativeUnitInsert): Promise<void> {
  await tx.insert(administrativeUnits).values(row);
}

export async function update(tx: Writer, id: string, tenantId: string, data: Partial<AdministrativeUnitInsert>): Promise<void> {
  await tx.update(administrativeUnits)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(administrativeUnits.id, id), eq(administrativeUnits.tenantId, tenantId)));
}

export { toView };
