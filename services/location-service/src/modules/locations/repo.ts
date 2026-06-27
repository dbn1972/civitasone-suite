import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
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
    parentId: r.parentId,
    type: r.type,
    lgdCode: r.lgdCode,
    status: r.status,
    isSample: r.isSample,
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

/** All locations for a tenant — used to assemble the branch-office tree. */
export async function listAllByTenant(tenantId: string): Promise<LocationView[]> {
  const rows = await db.select().from(locations)
    .where(eq(locations.tenantId, tenantId));
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: LocationInsert): Promise<void> {
  await tx.insert(locations).values(row);
}

/** The example offices a clerk can add to explore (clearly marked as samples). */
const SAMPLE_OFFICES: Array<Pick<LocationView, "name" | "addressLine" | "city" | "postalCode" | "type">> = [
  { name: "[SAMPLE] Head Office", addressLine: "1 Example Marg", city: "Bhubaneswar", postalCode: "751001", type: "office" },
  { name: "[SAMPLE] Cuttack Branch", addressLine: "12 Demo Road", city: "Cuttack", postalCode: "753001", type: "branch" },
  { name: "[SAMPLE] Puri Field Office", addressLine: "5 Trial Lane", city: "Puri", postalCode: "752001", type: "facility" },
];

/** Count this tenant's sample offices. */
export async function countSamples(tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.isSample, true)));
  return rows.length;
}

/**
 * Add the example offices for a tenant (idempotent: does nothing if samples
 * already exist). Returns the number added. Inserted directly (not via the
 * command queue) so the clerk sees them immediately.
 */
export async function seedSamples(tenantId: string, actorId: string): Promise<number> {
  if ((await countSamples(tenantId)) > 0) return 0;
  const now = new Date();
  const rows: LocationInsert[] = SAMPLE_OFFICES.map((o) => ({
    id: randomUUID(),
    tenantId,
    name: o.name,
    addressLine: o.addressLine,
    city: o.city,
    postalCode: o.postalCode,
    parentId: null,
    type: o.type,
    lgdCode: null,
    status: "active",
    isSample: true,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    updatedBy: actorId,
    version: 1,
  }));
  await db.insert(locations).values(rows);
  return rows.length;
}

/**
 * Remove ONLY this tenant's sample offices. Real offices (is_sample = false) are
 * never touched. Returns the number removed.
 */
export async function clearSamples(tenantId: string): Promise<number> {
  const removed = await db
    .delete(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.isSample, true)))
    .returning({ id: locations.id });
  return removed.length;
}

export { toView };
