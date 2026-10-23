import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  applicationDrafts, citizenApplications,
  type ApplicationDraftRow, type ApplicationDraftInsert, type ApplicationRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertDraft(tx: Writer, row: ApplicationDraftInsert): Promise<void> {
  await tx.insert(applicationDrafts).values(row);
}

export async function findDraftByIdTx(tx: Writer, id: string, tenantId: string): Promise<ApplicationDraftRow | null> {
  const rows = await (tx as typeof db).select().from(applicationDrafts)
    .where(and(eq(applicationDrafts.id, id), eq(applicationDrafts.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findDraftById(id: string, tenantId: string): Promise<ApplicationDraftRow | null> {
  return db.transaction((tx) => findDraftByIdTx(tx, id, tenantId));
}

export async function updateDraft(tx: Writer, id: string, tenantId: string, patch: Partial<ApplicationDraftInsert>): Promise<void> {
  await tx.update(applicationDrafts).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(applicationDrafts.id, id), eq(applicationDrafts.tenantId, tenantId)));
}

export interface DraftListFilter {
  /** Server-side filters: the web used to download every draft (with formData) and filter client-side. */
  serviceId?: string | undefined;
  status?: string | undefined;
  limit?: number | undefined;
}

export async function listDraftsByCitizen(
  tenantId: string,
  citizenId: string,
  filter: DraftListFilter = {},
): Promise<ApplicationDraftRow[]> {
  const conds = [eq(applicationDrafts.tenantId, tenantId), eq(applicationDrafts.citizenId, citizenId)];
  if (filter.serviceId) conds.push(eq(applicationDrafts.serviceId, filter.serviceId));
  if (filter.status) conds.push(eq(applicationDrafts.status, filter.status));
  const limit = Math.max(1, Math.min(200, filter.limit ?? 200));
  return db.transaction((tx) => tx.select().from(applicationDrafts)
    .where(and(...conds))
    .orderBy(desc(applicationDrafts.createdAt)).limit(limit));
}

/** Hard-delete a still-`draft` row (a submitted draft is the application's provenance and is kept). */
export async function deleteDraft(tx: Writer & Pick<typeof db, "delete">, id: string, tenantId: string): Promise<boolean> {
  const rows = await tx.delete(applicationDrafts)
    .where(and(eq(applicationDrafts.id, id), eq(applicationDrafts.tenantId, tenantId), eq(applicationDrafts.status, "draft")))
    .returning({ id: applicationDrafts.id });
  return rows.length > 0;
}

/** Look up an acknowledgement by its tracking number (tenant-scoped). */
export async function findApplicationByTracking(tenantId: string, trackingNo: string): Promise<ApplicationRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(citizenApplications)
    .where(and(eq(citizenApplications.tenantId, tenantId), eq(citizenApplications.trackingNo, trackingNo))).limit(1));
  return rows[0] ?? null;
}
