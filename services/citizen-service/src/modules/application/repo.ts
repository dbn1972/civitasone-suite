import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  citizenApplications, citizenAppDocuments, citizenStatusHistory,
  type ApplicationRow, type ApplicationInsert, type AppDocumentInsert, type StatusHistoryInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findApplicationById(id: string): Promise<ApplicationRow | null> {
  const rows = await db.select().from(citizenApplications).where(eq(citizenApplications.id, id)).limit(1);
  return rows[0] ?? null;
}

/** P1-2: scope by (id AND tenantId) so a forged foreign id cannot be read/mutated. */
export async function findApplicationByIdTx(tx: Writer, id: string, tenantId: string): Promise<ApplicationRow | null> {
  const rows = await (tx as typeof db).select().from(citizenApplications)
    .where(and(eq(citizenApplications.id, id), eq(citizenApplications.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listApplicationsByCitizen(tenantId: string, citizenId: string, limit = 200): Promise<ApplicationRow[]> {
  return db.select().from(citizenApplications)
    .where(and(eq(citizenApplications.tenantId, tenantId), eq(citizenApplications.citizenId, citizenId)))
    .limit(limit);
}

export async function listStatusHistory(applicationId: string) {
  return db.select().from(citizenStatusHistory).where(eq(citizenStatusHistory.applicationId, applicationId));
}

export async function listDocuments(applicationId: string) {
  return db.select().from(citizenAppDocuments).where(eq(citizenAppDocuments.applicationId, applicationId));
}

export async function insertApplication(tx: Writer, row: ApplicationInsert): Promise<void> {
  await tx.insert(citizenApplications).values(row);
}

export async function updateApplication(tx: Writer, id: string, tenantId: string, patch: Partial<ApplicationInsert>): Promise<void> {
  // P1-2: tenant-scoped update prevents cross-tenant writes via a forged id.
  await tx.update(citizenApplications).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(citizenApplications.id, id), eq(citizenApplications.tenantId, tenantId)));
}

export async function insertDocument(tx: Writer, row: AppDocumentInsert): Promise<void> {
  await tx.insert(citizenAppDocuments).values(row);
}

export async function insertStatusHistory(tx: Writer, row: StatusHistoryInsert): Promise<void> {
  await tx.insert(citizenStatusHistory).values(row);
}

export async function listOverdueApplications(tenantId: string, limit = 500): Promise<ApplicationRow[]> {
  return db.select().from(citizenApplications).where(eq(citizenApplications.tenantId, tenantId)).limit(limit);
}

export async function listApplicationsByTenant(tenantId: string, limit: number): Promise<ApplicationRow[]> {
  return db.select().from(citizenApplications).where(eq(citizenApplications.tenantId, tenantId)).limit(limit);
}
