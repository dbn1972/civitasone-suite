import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { citizenProfiles, citizenServices } from "./schema.js";
import type { ProfileInsert, ProfileRow, ServiceRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertProfile(tx: Writer, row: ProfileInsert): Promise<void> {
  await tx.insert(citizenProfiles).values(row);
}

/** DPDP §12: anonymise PII fields instead of hard-delete to preserve audit trail. */
export async function anonymiseProfile(tx: Writer, id: string, updatedBy: string): Promise<void> {
  await (tx as typeof db).update(citizenProfiles)
    .set({
      name:            "[DELETED]",
      email:           null,
      mobile:          null,
      digilockerToken: null,
      address:         null,
      updatedAt:       new Date(),
      updatedBy,
    })
    .where(eq(citizenProfiles.id, id));
}

export async function findProfileById(id: string): Promise<ProfileRow | null> {
  const rows = await db.select().from(citizenProfiles).where(eq(citizenProfiles.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findServiceById(id: string, tenantId: string): Promise<ServiceRow | null> {
  const rows = await db.select().from(citizenServices)
    .where(and(eq(citizenServices.id, id), eq(citizenServices.tenantId, tenantId), eq(citizenServices.active, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findServiceByIdTx(tx: Writer, id: string, tenantId: string): Promise<ServiceRow | null> {
  const rows = await tx.select().from(citizenServices)
    .where(and(eq(citizenServices.id, id), eq(citizenServices.tenantId, tenantId), eq(citizenServices.active, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listServices(tenantId: string, limit = 100): Promise<ServiceRow[]> {
  return db.select().from(citizenServices)
    .where(and(eq(citizenServices.tenantId, tenantId), eq(citizenServices.active, true)))
    .limit(limit);
}
