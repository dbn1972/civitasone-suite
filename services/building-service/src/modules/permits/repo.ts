import { eq, and, ne, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { buildingPermits, type BuildingPermitRow, type BuildingPermitInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<BuildingPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingPermits).where(and(eq(buildingPermits.id, id), eq(buildingPermits.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Public QR verification lookup (GET /v1/building/permits/verify). Reads the
 * RLS-protected building_permit_directory (public facts only) through the token-scoped public_verify_read policy -- an anonymous request has no tenant GUC, so the
 * FORCE-RLS building_permits table would return zero rows for every code. See
 * migrations/0005_permit_public_directory.sql.
 */
export async function findPublicByVerificationCode(code: string) {
  return scopedRead(async (tx) => {
    // The directory is FORCE RLS; the public_verify_read policy admits exactly the row whose
    // verification_code equals this transaction-local GUC (migrations/0006_permit_directory_rls.sql).
    await tx.execute(sql`SELECT set_config('app.permit_verification_code', ${code}, true)`);
    const rows = (await tx.execute(
      sql`SELECT permit_number AS "permitNumber", status, issued_at AS "issuedAt", valid_until AS "validUntil"
          FROM building.building_permit_directory
          WHERE verification_code = ${code}
          LIMIT 1`,
    )) as unknown as Array<{
      permitNumber: string;
      status: string;
      issuedAt: Date | null;
      validUntil: Date | null;
    }>;
    return rows[0] ?? null;
  });
}

// Used by permits/routes.ts's POST /v1/building/permits pre-accept
// PERMIT_ALREADY_EXISTS check ahead of the building_permits_application_id_key
// index (see PR #1001 / migrations/0002_permit_reissuance_unique_constraint.sql).
// A cancelled permit (issued in error, or the applicant needed to reschedule)
// must not permanently block a legitimate new permit for the same approved
// application, so 'cancelled' is excluded here, matching the migration's
// partial unique index (WHERE status != 'cancelled') exactly. 'expired' is
// deliberately NOT excluded: building-service DOES have a renewal flow for
// expired permits (POST /v1/building/renewals, lifecycle/domain.ts's
// canRequestRenewal() allows renewal from 'expired'). Keeping 'expired'
// inside this check forces callers through that renewal path instead of
// here, unlike advertisement-service's canRenew) -- excluding it would be
// reissuing a new permit through this duplicate-check path.
export async function findByApplicationId(applicationId: string, tenantId: string): Promise<BuildingPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingPermits).where(and(
      eq(buildingPermits.applicationId, applicationId),
      eq(buildingPermits.tenantId, tenantId),
      ne(buildingPermits.status, "cancelled"),
    )).limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: BuildingPermitRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(buildingPermits.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(buildingPermits.status, opts.status));
  const rows = await scopedRead((tx) =>
    tx.select().from(buildingPermits).where(and(...conditions)).orderBy(desc(buildingPermits.issuedAt)).limit(pageSize).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(buildingPermits).where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertPermit(tx: ScopedTx, row: BuildingPermitInsert): Promise<void> {
  await tx.insert(buildingPermits).values(row);
  // Public verification directory, same transaction (migrations/0005_permit_public_directory.sql).
  await tx.execute(
    sql`INSERT INTO building.building_permit_directory
          (verification_code, tenant_id, permit_id, permit_number, status, issued_at, valid_until)
        VALUES (${row.verificationCode}, ${row.tenantId}, ${row.id ?? null}, ${row.permitNumber}, ${row.status ?? "active"},
                ${row.issuedAt ? row.issuedAt.toISOString() : null}, ${row.validUntil ? row.validUntil.toISOString() : null})
        ON CONFLICT (verification_code) DO NOTHING`,
  );
}

export async function updatePermitStatus(
  tx: ScopedTx, id: string, tenantId: string, status: string,
  fields: Partial<Pick<BuildingPermitRow, "suspendedAt" | "suspensionReason" | "cancelledAt" | "cancellationReason">>,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(buildingPermits)
    .set({ status, ...fields, updatedBy, updatedAt: new Date(), version: sql`${buildingPermits.version} + 1` })
    .where(and(eq(buildingPermits.id, id), eq(buildingPermits.tenantId, tenantId)))
    .returning({ id: buildingPermits.id });
  if (result.length > 0) {
    await tx.execute(
      sql`UPDATE building.building_permit_directory SET status = ${status}, updated_at = now()
          WHERE permit_id = ${id} AND tenant_id = ${tenantId}`,
    );
  }
  return result.length > 0;
}

export async function updateValidUntil(
  tx: ScopedTx, id: string, tenantId: string, validUntil: Date, updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(buildingPermits)
    .set({ validUntil, updatedBy, updatedAt: new Date(), version: sql`${buildingPermits.version} + 1` })
    .where(and(eq(buildingPermits.id, id), eq(buildingPermits.tenantId, tenantId)))
    .returning({ id: buildingPermits.id });
  if (result.length > 0) {
    await tx.execute(
      sql`UPDATE building.building_permit_directory SET valid_until = ${validUntil.toISOString()}, updated_at = now()
          WHERE permit_id = ${id} AND tenant_id = ${tenantId}`,
    );
  }
  return result.length > 0;
}

// CLOS3-S4-09: reference numbers come from a Postgres SEQUENCE (migration, same fix as drainage #2182),
// allocated inside the transaction that inserts the row. A randomInt() number collided on the UNIQUE
// column after the caller already held a 202 and the accepted request was lost. A rolled-back
// transaction leaves a gap but never a duplicate.
export async function nextPermitNumberSeq(tx: ScopedTx): Promise<number> {
  const rows = (await tx.execute(sql`SELECT nextval('building.permit_number_seq')::bigint AS seq`)) as unknown as Array<{ seq: string | number }>;
  return Number(rows[0]!.seq);
}
