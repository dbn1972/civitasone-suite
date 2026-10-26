import { eq, and, ne, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { advPermits, advRenewals, type AdvPermitRow, type AdvPermitInsert, type AdvRenewalInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<AdvPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(advPermits)
      .where(and(eq(advPermits.id, id), eq(advPermits.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Public QR verification lookup (GET /v1/advertisement/permits/verify). Reads the
 * RLS-protected adv_permit_directory (public facts only) through the token-scoped public_verify_read policy -- an anonymous request has no tenant GUC, so the
 * FORCE-RLS adv_permits table would return zero rows for every code. See
 * migrations/0006_permit_public_directory.sql.
 */
export async function findPublicByVerificationCode(code: string) {
  return scopedRead(async (tx) => {
    // The directory is FORCE RLS; the public_verify_read policy admits exactly the row whose
    // verification_code equals this transaction-local GUC (migrations/0007_permit_directory_rls.sql).
    await tx.execute(sql`SELECT set_config('app.permit_verification_code', ${code}, true)`);
    const rows = (await tx.execute(
      sql`SELECT permit_number AS "permitNumber", advertisement_type AS "advertisementType", status,
                 issued_at AS "issuedAt", valid_from AS "validFrom", valid_until AS "validUntil"
          FROM adv_permits.adv_permit_directory
          WHERE verification_code = ${code}
          LIMIT 1`,
    )) as unknown as Array<{
      permitNumber: string;
      advertisementType: string;
      status: string;
      issuedAt: Date | null;
      validFrom: string | null;
      validUntil: string | null;
    }>;
    return rows[0] ?? null;
  });
}

// Added for the POST /v1/advertisement/permits pre-accept check (mirrors
// roadcut-service's permits/routes.ts PERMIT_ALREADY_EXISTS guard): without
// this, a permit could be issued more than once against the same
// application. adv_permits previously had no unique/FK constraint on
// application_id at all -- migrations/0004_permit_reissuance_unique_constraint.sql
// now adds one, as a partial index excluding 'cancelled' and 'expired' so
// this query and the DB constraint agree.
//
// Both 'cancelled' and 'expired' are excluded, not just 'cancelled':
// domain.ts's canRenew() explicitly treats them the same way -- neither can
// go through POST /v1/advertisement/permits/:id/renew ("a cancelled or
// expired permit could be 'renewed' ... suspended/expired/cancelled must be
// excluded"). Since renewal (extending validity) is unavailable for both,
// the only way forward for either is a fresh permit issuance under the same
// application -- exactly what this duplicate check must not block.
export async function findByApplication(applicationId: string, tenantId: string): Promise<AdvPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(advPermits)
      .where(and(
        eq(advPermits.applicationId, applicationId),
        eq(advPermits.tenantId, tenantId),
        ne(advPermits.status, "cancelled"),
        ne(advPermits.status, "expired"),
      ))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: AdvPermitRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(advPermits.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(advPermits.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(advPermits)
      .where(and(...conditions))
      .orderBy(desc(advPermits.createdAt))
      .limit(pageSize)
      .offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(advPermits)
      .where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertPermit(tx: ScopedTx, row: AdvPermitInsert): Promise<void> {
  await tx.insert(advPermits).values(row);
  // Public verification directory, same transaction (migrations/0006_permit_public_directory.sql).
  await tx.execute(
    sql`INSERT INTO adv_permits.adv_permit_directory
          (verification_code, tenant_id, permit_id, permit_number, advertisement_type, status, issued_at, valid_from, valid_until)
        VALUES (${row.verificationCode}, ${row.tenantId}, ${row.id ?? null}, ${row.permitNumber}, ${row.advertisementType},
                ${row.status ?? "issued"}, ${row.issuedAt ? row.issuedAt.toISOString() : null},
                ${row.validFrom ?? null}, ${row.validUntil ?? null})
        ON CONFLICT (verification_code) DO NOTHING`,
  );
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
  extra?: Partial<{ suspensionReason: string; cancellationReason: string; suspendedAt: Date; cancelledAt: Date }>,
): Promise<boolean> {
  const result = await tx.update(advPermits)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...extra,
      version: sql`${advPermits.version} + 1`,
    })
    .where(and(eq(advPermits.id, id), eq(advPermits.tenantId, tenantId)))
    .returning({ id: advPermits.id });
  if (result.length > 0) {
    await tx.execute(
      sql`UPDATE adv_permits.adv_permit_directory SET status = ${status}, updated_at = now()
          WHERE permit_id = ${id} AND tenant_id = ${tenantId}`,
    );
  }
  return result.length > 0;
}

export async function insertRenewal(tx: ScopedTx, row: AdvRenewalInsert): Promise<void> {
  await tx.insert(advRenewals).values(row);
}

export async function updateValidUntil(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  validUntil: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(advPermits)
    .set({ validUntil, updatedBy, updatedAt: new Date(), version: sql`${advPermits.version} + 1` })
    .where(and(eq(advPermits.id, id), eq(advPermits.tenantId, tenantId)))
    .returning({ id: advPermits.id });
  if (result.length > 0) {
    await tx.execute(
      sql`UPDATE adv_permits.adv_permit_directory SET valid_until = ${validUntil}, updated_at = now()
          WHERE permit_id = ${id} AND tenant_id = ${tenantId}`,
    );
  }
  return result.length > 0;
}

// BUG FIX (collision-prone number generation): see
// applications/repo.ts's nextApplicationNumberSeq for the full rationale —
// same fix, same shape, for permit_number. See
// migrations/0003_number_sequences.sql.
export async function nextPermitNumberSeq(tx: ScopedTx): Promise<number> {
  const rows = (await tx.execute(
    sql`SELECT nextval('adv_permits.permit_number_seq') AS seq`,
  )) as unknown as Array<{ seq: string | number }>;
  return Number(rows[0]!.seq);
}
