import { eq, and, desc, isNull, gt } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  documentSubmissions,
  digilockerOauthStates, digilockerConsents,
  type DocSubmissionRow, type DocSubmissionInsert,
  type OauthStateRow, type OauthStateInsert,
  type ConsentRow, type ConsentInsert,
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

export async function listByApplicationForCitizenTx(tx: Writer, tenantId: string, applicationId: string, citizenId: string): Promise<DocSubmissionRow[]> {
  return (tx as typeof db).select().from(documentSubmissions)
    .where(and(eq(documentSubmissions.tenantId, tenantId), eq(documentSubmissions.applicationId, applicationId), eq(documentSubmissions.citizenId, citizenId)))
    .orderBy(desc(documentSubmissions.createdAt));
}

export async function listByApplicationForCitizen(tenantId: string, applicationId: string, citizenId: string): Promise<DocSubmissionRow[]> {
  return db.transaction((tx) => listByApplicationForCitizenTx(tx, tenantId, applicationId, citizenId));
}

export async function listPendingVerification(tenantId: string, limit = 200): Promise<DocSubmissionRow[]> {
  return db.transaction((tx) => tx.select().from(documentSubmissions)
    .where(and(eq(documentSubmissions.tenantId, tenantId), eq(documentSubmissions.verificationStatus, "pending")))
    .orderBy(desc(documentSubmissions.createdAt)).limit(limit));
}

// ── GAP-CITIZEN-DOCUMENTS-02: OAuth state + consent persistence ────────────

export async function insertOauthStateTx(tx: Writer, row: OauthStateInsert): Promise<void> {
  await tx.insert(digilockerOauthStates).values(row);
}

export async function insertOauthState(row: OauthStateInsert): Promise<void> {
  await db.transaction((tx) => insertOauthStateTx(tx, row));
}

export async function findOauthStateTx(tx: Writer, state: string, tenantId: string): Promise<OauthStateRow | null> {
  const rows = await (tx as typeof db).select().from(digilockerOauthStates)
    .where(and(eq(digilockerOauthStates.state, state), eq(digilockerOauthStates.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findOauthState(state: string, tenantId: string): Promise<OauthStateRow | null> {
  return db.transaction((tx) => findOauthStateTx(tx, state, tenantId));
}

/** Mark an oauth state consumed (single-use); callers must check it was unconsumed first. */
/** Atomically consume a single-use state. Returns the number of rows consumed (0 = already used/unknown). */
export async function consumeOauthStateTx(tx: Writer, state: string, tenantId: string): Promise<number> {
  const rows = await tx.update(digilockerOauthStates).set({ consumedAt: new Date() })
    .where(and(
      eq(digilockerOauthStates.state, state), eq(digilockerOauthStates.tenantId, tenantId),
      isNull(digilockerOauthStates.consumedAt),
    ))
    .returning({ state: digilockerOauthStates.state });
  return rows.length;
}

export async function insertConsentTx(tx: Writer, row: ConsentInsert): Promise<void> {
  await tx.insert(digilockerConsents).values(row);
}

/**
 * The most-recent LIVE consent for (tenant, citizen, docType): not revoked and
 * not expired. `citizenId` null matches rows with a null citizen (self-service).
 */
export async function findLiveConsent(
  tenantId: string, citizenId: string | null, docType: string, at: Date = new Date(),
): Promise<ConsentRow | null> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(digilockerConsents).where(and(
      eq(digilockerConsents.tenantId, tenantId),
      citizenId === null ? isNull(digilockerConsents.citizenId) : eq(digilockerConsents.citizenId, citizenId),
      eq(digilockerConsents.docType, docType),
      isNull(digilockerConsents.revokedAt),
      gt(digilockerConsents.expiresAt, at),
    )).orderBy(desc(digilockerConsents.grantedAt)).limit(1);
    return rows[0] ?? null;
  });
}
