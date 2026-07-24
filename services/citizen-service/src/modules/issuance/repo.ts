import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  issuanceCounters, certificates, certificateEvents,
  type CertificateRow, type CertificateInsert, type CertEventInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * Atomically reserve the next gapless sequence for (tenant, type, year).
 * The INSERT..ON CONFLICT DO UPDATE ... RETURNING is race-free — two concurrent
 * issuances serialize on the counter PK and receive consecutive numbers.
 */
export async function nextSequence(tx: Writer, tenantId: string, certType: string, year: number): Promise<number> {
  const rows = await (tx as typeof db).insert(issuanceCounters)
    .values({ tenantId, certType, year, lastSeq: 1 })
    .onConflictDoUpdate({
      target: [issuanceCounters.tenantId, issuanceCounters.certType, issuanceCounters.year],
      set: { lastSeq: sql`${issuanceCounters.lastSeq} + 1`, updatedAt: new Date() },
    })
    .returning({ lastSeq: issuanceCounters.lastSeq });
  return rows[0]!.lastSeq;
}

export async function insertCertificate(tx: Writer, row: CertificateInsert): Promise<void> {
  await tx.insert(certificates).values(row);
}

export async function findCertByIdTx(tx: Writer, id: string, tenantId: string): Promise<CertificateRow | null> {
  const rows = await (tx as typeof db).select().from(certificates)
    .where(and(eq(certificates.id, id), eq(certificates.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findCertById(id: string, tenantId: string): Promise<CertificateRow | null> {
  return db.transaction((tx) => findCertByIdTx(tx, id, tenantId));
}

/** Public verify: look up by opaque token WITHOUT a tenant filter (token is the secret). */
export async function findCertByToken(token: string): Promise<CertificateRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(certificates)
    .where(eq(certificates.verifyToken, token)).limit(1));
  return rows[0] ?? null;
}

export async function updateCert(tx: Writer, id: string, tenantId: string, patch: Partial<CertificateInsert>): Promise<void> {
  await tx.update(certificates).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(certificates.id, id), eq(certificates.tenantId, tenantId)));
}

export async function listCertificates(tenantId: string, limit = 200): Promise<CertificateRow[]> {
  return db.transaction((tx) => tx.select().from(certificates)
    .where(eq(certificates.tenantId, tenantId)).orderBy(desc(certificates.createdAt)).limit(limit));
}

export async function insertEvent(tx: Writer, row: CertEventInsert): Promise<void> {
  await tx.insert(certificateEvents).values(row);
}

export async function listEvents(tenantId: string, certificateId: string) {
  return db.transaction((tx) => tx.select().from(certificateEvents)
    .where(and(eq(certificateEvents.tenantId, tenantId), eq(certificateEvents.certificateId, certificateId)))
    .orderBy(desc(certificateEvents.createdAt)));
}
