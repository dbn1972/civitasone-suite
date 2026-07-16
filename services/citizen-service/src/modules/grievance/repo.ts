import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  citizenGrievances, citizenGrievanceActions, citizenEscalations,
  type GrievanceRow, type GrievanceInsert, type GrievanceActionInsert, type EscalationInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findGrievanceById(id: string): Promise<GrievanceRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(citizenGrievances).where(eq(citizenGrievances.id, id)).limit(1));
  return rows[0] ?? null;
}

/** P1-2: scope by (id AND tenantId) so a forged foreign id cannot be read/mutated. */
export async function findGrievanceByIdTx(tx: Writer, id: string, tenantId: string): Promise<GrievanceRow | null> {
  const rows = await (tx as typeof db).select().from(citizenGrievances)
    .where(and(eq(citizenGrievances.id, id), eq(citizenGrievances.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listGrievancesByCitizen(tenantId: string, citizenId: string, limit = 200): Promise<GrievanceRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(citizenGrievances)
    .where(and(eq(citizenGrievances.tenantId, tenantId), eq(citizenGrievances.citizenId, citizenId)))
    .limit(limit));
}

export async function listGrievancesByTenant(tenantId: string, limit: number, offset: number): Promise<GrievanceRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(citizenGrievances)
    .where(eq(citizenGrievances.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
}

export async function listActions(grievanceId: string) {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(citizenGrievanceActions).where(eq(citizenGrievanceActions.grievanceId, grievanceId)));
}

export async function insertGrievance(tx: Writer, row: GrievanceInsert): Promise<void> {
  await tx.insert(citizenGrievances).values(row);
}

export async function updateGrievance(tx: Writer, id: string, tenantId: string, patch: Partial<GrievanceInsert>): Promise<void> {
  // P1-2: tenant-scoped update prevents cross-tenant writes via a forged id.
  await tx.update(citizenGrievances).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(citizenGrievances.id, id), eq(citizenGrievances.tenantId, tenantId)));
}

export async function insertAction(tx: Writer, row: GrievanceActionInsert): Promise<void> {
  await tx.insert(citizenGrievanceActions).values(row);
}

export async function insertEscalation(tx: Writer, row: EscalationInsert): Promise<void> {
  await tx.insert(citizenEscalations).values(row);
}
