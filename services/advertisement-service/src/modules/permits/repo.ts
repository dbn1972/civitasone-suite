import { eq, and, sql, desc } from "drizzle-orm";
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

export async function findByVerificationCode(code: string): Promise<AdvPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(advPermits)
      .where(eq(advPermits.verificationCode, code))
      .limit(1),
  );
  return rows[0] ?? null;
}

// Added for the POST /v1/advertisement/permits pre-accept check (mirrors
// roadcut-service's permits/routes.ts PERMIT_ALREADY_EXISTS guard): without
// this, a permit could be issued more than once against the same
// application, since adv_permits has no unique/FK constraint on
// application_id.
export async function findByApplication(applicationId: string, tenantId: string): Promise<AdvPermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(advPermits)
      .where(and(eq(advPermits.applicationId, applicationId), eq(advPermits.tenantId, tenantId)))
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
