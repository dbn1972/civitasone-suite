import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { citizenProfiles, citizenServices } from "./schema.js";
import type { ProfileInsert, ProfileRow, ServiceRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertProfile(tx: Writer, row: ProfileInsert): Promise<void> {
  await tx.insert(citizenProfiles).values(row);
}

/**
 * DPDP §12: anonymise PII fields instead of hard-delete to preserve audit trail.
 * P0-4: scoped by (id AND tenantId) so a cross-tenant erasure touches no rows.
 * Returns the number of rows affected (0 = not found / wrong tenant).
 */
export async function anonymiseProfile(tx: Writer, id: string, tenantId: string, updatedBy: string): Promise<number> {
  const updated = await (tx as typeof db).update(citizenProfiles)
    .set({
      name:            "[DELETED]",
      email:           null,
      mobile:          null,
      digilockerToken: null,
      address:         null,
      updatedAt:       new Date(),
      updatedBy,
    })
    .where(and(eq(citizenProfiles.id, id), eq(citizenProfiles.tenantId, tenantId)))
    .returning({ id: citizenProfiles.id });
  return updated.length;
}

export async function findProfileById(id: string, tenantId: string): Promise<ProfileRow | null> {
  // P1-6: scope by (id AND tenantId) so an officer summary cannot leak a
  // cross-tenant profile via a citizenId that exists under another tenant.
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(citizenProfiles)
    .where(and(eq(citizenProfiles.id, id), eq(citizenProfiles.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findServiceById(id: string, tenantId: string): Promise<ServiceRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(citizenServices)
    .where(and(eq(citizenServices.id, id), eq(citizenServices.tenantId, tenantId), eq(citizenServices.active, true)))
    .limit(1));
  return rows[0] ?? null;
}

export async function findServiceByIdTx(tx: Writer, id: string, tenantId: string): Promise<ServiceRow | null> {
  const rows = await tx.select().from(citizenServices)
    .where(and(eq(citizenServices.id, id), eq(citizenServices.tenantId, tenantId), eq(citizenServices.active, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listServices(tenantId: string, limit = 100): Promise<ServiceRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(citizenServices)
    .where(and(eq(citizenServices.tenantId, tenantId), eq(citizenServices.active, true)))
    .limit(limit));
}
