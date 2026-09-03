import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  tradeLicences, licenceActions, tradeLicenceDirectory,
  type TradeLicenceRow, type TradeLicenceInsert, type LicenceActionRow, type LicenceActionInsert,
  type TradeLicenceDirectoryInsert,
} from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<TradeLicenceRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(tradeLicences)
      .where(and(eq(tradeLicences.id, id), eq(tradeLicences.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** Tenant-scoped lookup (RLS-protected). Not used by the public verify route — see findPublicByVerificationCode. */
export async function findByVerificationCode(code: string, tenantId: string): Promise<TradeLicenceRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(tradeLicences)
      .where(and(eq(tradeLicences.verificationCode, code), eq(tradeLicences.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Public verification lookup (NO tenant, NO auth — see schema.ts's
 * tradeLicenceDirectory doc comment). Deliberately plain `db.select()`, not
 * `scopedRead`: the directory table carries no RLS, so there is no GUC to set
 * and wrapping it in a tenant-scoped transaction would be misleading.
 */
export async function findPublicByVerificationCode(code: string) {
  const rows = await db.select().from(tradeLicenceDirectory)
    .where(eq(tradeLicenceDirectory.verificationCode, code))
    .limit(1);
  return rows[0] ?? null;
}

export async function findByApplicationId(applicationId: string, tenantId: string): Promise<TradeLicenceRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(tradeLicences)
      .where(and(eq(tradeLicences.applicationId, applicationId), eq(tradeLicences.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: TradeLicenceRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(tradeLicences.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(tradeLicences.status, opts.status));
  const rows = await scopedRead((tx) =>
    tx.select().from(tradeLicences).where(and(...conditions)).orderBy(desc(tradeLicences.issuedAt)).limit(pageSize).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(tradeLicences).where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertLicence(tx: ScopedTx, row: TradeLicenceInsert): Promise<void> {
  await tx.insert(tradeLicences).values(row);
}

/**
 * Insert the public-directory mirror of a freshly issued licence, in the SAME
 * transaction as insertLicence — see schema.ts's tradeLicenceDirectory comment.
 * onConflictDoNothing on the PK makes this safe against a consumer redelivery
 * of the same createLicence message.
 */
export async function insertDirectoryEntry(tx: ScopedTx, row: TradeLicenceDirectoryInsert): Promise<void> {
  await tx.insert(tradeLicenceDirectory).values(row).onConflictDoNothing({ target: tradeLicenceDirectory.verificationCode });
}

export async function updateLicenceStatus(
  tx: ScopedTx, id: string, tenantId: string, status: string,
  fields: Partial<Pick<TradeLicenceRow, "suspendedAt" | "suspensionReason" | "cancelledAt" | "cancellationReason">>,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(tradeLicences)
    .set({ status, ...fields, updatedBy, updatedAt: new Date(), version: sql`${tradeLicences.version} + 1` })
    .where(and(eq(tradeLicences.id, id), eq(tradeLicences.tenantId, tenantId)))
    .returning({ id: tradeLicences.id });
  if (result.length > 0) {
    // Keep the public directory's status in lockstep with the RLS-protected
    // row it mirrors — same transaction, so the two can never drift.
    await tx.update(tradeLicenceDirectory)
      .set({ status, updatedAt: new Date() })
      .where(eq(tradeLicenceDirectory.licenceId, id));
  }
  return result.length > 0;
}

export async function insertAction(tx: ScopedTx, row: LicenceActionInsert): Promise<void> {
  await tx.insert(licenceActions).values(row);
}

export async function listActions(licenceId: string, tenantId: string): Promise<LicenceActionRow[]> {
  return scopedRead((tx) =>
    tx.select().from(licenceActions)
      .where(and(eq(licenceActions.licenceId, licenceId), eq(licenceActions.tenantId, tenantId)))
      .orderBy(desc(licenceActions.createdAt)),
  );
}

export async function updateValidUntil(
  tx: ScopedTx, id: string, tenantId: string, validUntil: Date, updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(tradeLicences)
    .set({ validUntil, updatedBy, updatedAt: new Date(), version: sql`${tradeLicences.version} + 1` })
    .where(and(eq(tradeLicences.id, id), eq(tradeLicences.tenantId, tenantId)))
    .returning({ id: tradeLicences.id });
  if (result.length > 0) {
    await tx.update(tradeLicenceDirectory)
      .set({ validUntil, updatedAt: new Date() })
      .where(eq(tradeLicenceDirectory.licenceId, id));
  }
  return result.length > 0;
}
