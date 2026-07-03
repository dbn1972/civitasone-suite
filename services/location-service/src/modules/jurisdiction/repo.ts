import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { jurisdictions, type JurisdictionRow, type JurisdictionInsert, type JurisdictionView } from "./schema.js";

function toView(r: JurisdictionRow): JurisdictionView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    officeId: r.officeId,
    unitId: r.unitId,
    level: r.level,
    isPrimary: r.isPrimary,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<JurisdictionView | null> {
  const rows = await db.select().from(jurisdictions).where(eq(jurisdictions.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function findByOffice(officeId: string, tenantId: string): Promise<JurisdictionView[]> {
  const rows = await db.select().from(jurisdictions)
    .where(and(eq(jurisdictions.officeId, officeId), eq(jurisdictions.tenantId, tenantId)));
  return rows.map(toView);
}

export async function findByUnit(unitId: string, tenantId: string): Promise<JurisdictionView[]> {
  const rows = await db.select().from(jurisdictions)
    .where(and(eq(jurisdictions.unitId, unitId), eq(jurisdictions.tenantId, tenantId)));
  return rows.map(toView);
}

/** Find all offices that have jurisdiction over a given administrative area. */
export async function findOfficesByArea(unitId: string, tenantId: string): Promise<JurisdictionView[]> {
  return findByUnit(unitId, tenantId);
}

/** Find the primary administrative area for a given office. */
export async function findAreaForOffice(officeId: string, tenantId: string): Promise<JurisdictionView | null> {
  const rows = await db.select().from(jurisdictions)
    .where(and(
      eq(jurisdictions.officeId, officeId),
      eq(jurisdictions.tenantId, tenantId),
      eq(jurisdictions.isPrimary, true),
    ))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<JurisdictionView[]> {
  const rows = await db.select().from(jurisdictions)
    .where(eq(jurisdictions.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "delete" | "select">;

export async function insert(tx: Writer, row: JurisdictionInsert): Promise<void> {
  await tx.insert(jurisdictions).values(row);
}

export async function remove(tx: Writer, id: string, tenantId: string): Promise<void> {
  await tx.delete(jurisdictions)
    .where(and(eq(jurisdictions.id, id), eq(jurisdictions.tenantId, tenantId)));
}

export { toView };
