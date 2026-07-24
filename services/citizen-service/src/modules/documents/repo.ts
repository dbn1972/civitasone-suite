import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  documentSubmissions,
  type DocSubmissionRow, type DocSubmissionInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertSubmission(tx: Writer, row: DocSubmissionInsert): Promise<void> {
  await tx.insert(documentSubmissions).values(row);
}

export async function findSubmissionByIdTx(tx: Writer, id: string, tenantId: string): Promise<DocSubmissionRow | null> {
  const rows = await (tx as typeof db).select().from(documentSubmissions)
    .where(and(eq(documentSubmissions.id, id), eq(documentSubmissions.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findSubmissionById(id: string, tenantId: string): Promise<DocSubmissionRow | null> {
  return db.transaction((tx) => findSubmissionByIdTx(tx, id, tenantId));
}

export async function updateSubmission(tx: Writer, id: string, tenantId: string, patch: Partial<DocSubmissionInsert>): Promise<void> {
  await tx.update(documentSubmissions).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(documentSubmissions.id, id), eq(documentSubmissions.tenantId, tenantId)));
}

export async function listByApplicationTx(tx: Writer, tenantId: string, applicationId: string): Promise<DocSubmissionRow[]> {
  return (tx as typeof db).select().from(documentSubmissions)
    .where(and(eq(documentSubmissions.tenantId, tenantId), eq(documentSubmissions.applicationId, applicationId)))
    .orderBy(desc(documentSubmissions.createdAt));
}

export async function listByApplication(tenantId: string, applicationId: string): Promise<DocSubmissionRow[]> {
  return db.transaction((tx) => listByApplicationTx(tx, tenantId, applicationId));
}

export async function listPendingVerification(tenantId: string, limit = 200): Promise<DocSubmissionRow[]> {
  return db.transaction((tx) => tx.select().from(documentSubmissions)
    .where(and(eq(documentSubmissions.tenantId, tenantId), eq(documentSubmissions.verificationStatus, "pending")))
    .orderBy(desc(documentSubmissions.createdAt)).limit(limit));
}
