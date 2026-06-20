import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { locations, type LocationRow, type LocationInsert, type LocationView } from "./schema.js";

function toView(r: LocationRow): LocationView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    addressLine: r.addressLine,
    city: r.city,
    postalCode: r.postalCode,
    status: r.status,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<LocationView | null> {
  const rows = await db.select().from(locations).where(eq(locations.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<LocationView[]> {
  const rows = await db.select().from(locations)
    .where(eq(locations.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: LocationInsert): Promise<void> {
  await tx.insert(locations).values(row);
}

export { toView };
