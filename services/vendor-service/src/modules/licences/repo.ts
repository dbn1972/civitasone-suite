import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { vendorLicences, type VendorLicenceRow, type VendorLicenceInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<VendorLicenceRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(vendorLicences)
      .where(and(eq(vendorLicences.id, id), eq(vendorLicences.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByRegistration(registrationId: string, tenantId: string): Promise<VendorLicenceRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(vendorLicences)
      .where(and(eq(vendorLicences.registrationId, registrationId), eq(vendorLicences.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: VendorLicenceRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(vendorLicences.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(vendorLicences.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(vendorLicences)
      .where(and(...conditions))
      .orderBy(desc(vendorLicences.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(vendorLicences)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertLicence(tx: ScopedTx, row: VendorLicenceInsert): Promise<void> {
  await tx.insert(vendorLicences).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(vendorLicences)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${vendorLicences.version} + 1`,
    })
    .where(and(eq(vendorLicences.id, id), eq(vendorLicences.tenantId, tenantId)))
    .returning({ id: vendorLicences.id });
  return result.length > 0;
}

/**
 * Idempotency guard's persistence half — see licences/routes.ts's
 * fee-payment route for the pre-accept half (existing.feePaid -> 409).
 * Mirrors trade-service/applications/repo.ts's updateFeePayment exactly
 * (same column shape: fee_paid boolean + fee_transaction_id varchar(128)).
 */
export async function updateFeePayment(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  transactionId: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(vendorLicences)
    .set({
      feePaid: true,
      feeTransactionId: transactionId,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${vendorLicences.version} + 1`,
    })
    .where(and(eq(vendorLicences.id, id), eq(vendorLicences.tenantId, tenantId)))
    .returning({ id: vendorLicences.id });
  return result.length > 0;
}

/**
 * Replaces `Date.now() % 999999` (see licences/consumer.ts's issueLicence
 * handler) with a real Postgres SEQUENCE reserved inside the same
 * transaction as the insert — guaranteed unique across concurrent callers,
 * independent of wall-clock time. Same fix shape as animal-service's
 * nextComplaintNumber/nextRegistrationNumber (migrations/
 * 0002_number_sequences.sql there; migrations/0002_number_sequences.sql
 * here).
 */
export async function nextLicenceNumber(tx: ScopedTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"vendor"."licence_number_seq"')::bigint AS seq`,
  )) as Array<{ seq: number }>;
  return Number(row!.seq);
}
