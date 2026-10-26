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

/**
 * The non-PII attestation projection the PUBLIC verify route is allowed to read.
 * Deliberately excludes subject, payload, applicationId, tenantId and every actor column.
 */
export type CertVerificationRow = Pick<CertificateRow,
  "certNo" | "certType" | "status" | "validFrom" | "validTo" | "payloadHash" | "signature" | "issuedAt">;

/** Opaque token shape produced by generateVerifyToken() (24 random bytes, base64url). */
const VERIFY_TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Public verify: look up by opaque token WITHOUT a tenant filter (the token is the secret).
 *
 * issuance.certificates is FORCE RLS and an anonymous caller has no tenant, so the read sets the
 * transaction-local GUC app.cert_verify_token to the PRESENTED token; the SELECT-only policy
 * public_verify_read (migration 0044) then exposes exactly the row with that token. Nothing else
 * becomes visible and FORCE RLS is untouched for every other access.
 */
export async function findCertByToken(token: string): Promise<CertVerificationRow | null> {
  if (!VERIFY_TOKEN_RE.test(token)) return null;
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.cert_verify_token', ${token}, true)`);
    return tx.select({
      certNo: certificates.certNo,
      certType: certificates.certType,
      status: certificates.status,
      validFrom: certificates.validFrom,
      validTo: certificates.validTo,
      payloadHash: certificates.payloadHash,
      signature: certificates.signature,
      issuedAt: certificates.issuedAt,
    }).from(certificates)
      .where(eq(certificates.verifyToken, token)).limit(1);
  });
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
