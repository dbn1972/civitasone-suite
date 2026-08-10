import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  permits, permitActions,
  type PermitRow, type PermitInsert,
  type PermitActionRow, type PermitActionInsert,
} from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<PermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(permits)
      .where(and(eq(permits.id, id), eq(permits.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByVerificationCode(code: string): Promise<PermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(permits)
      .where(eq(permits.verificationCode, code))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByApplicationId(applicationId: string, tenantId: string): Promise<PermitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(permits)
      .where(and(eq(permits.applicationId, applicationId), eq(permits.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: PermitRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const conditions = [eq(permits.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(permits.permitStatus, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(permits)
      .where(and(...conditions))
      .orderBy(desc(permits.issuedAt))
      .limit(pageSize)
      .offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(permits)
      .where(and(...conditions)),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertPermit(tx: ScopedTx, row: PermitInsert): Promise<void> {
  await tx.insert(permits).values(row);
}

export async function updatePermitStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  fields: Partial<Pick<PermitRow, "suspendedAt" | "suspensionReason" | "cancelledAt" | "cancellationReason">>,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(permits)
    .set({
      permitStatus: status,
      ...fields,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${permits.version} + 1`,
    })
    .where(and(eq(permits.id, id), eq(permits.tenantId, tenantId)))
    .returning({ id: permits.id });
  return result.length > 0;
}

export async function insertAction(tx: ScopedTx, row: PermitActionInsert): Promise<void> {
  await tx.insert(permitActions).values(row);
}

export async function listActions(permitId: string, tenantId: string): Promise<PermitActionRow[]> {
  return scopedRead((tx) =>
    tx.select().from(permitActions)
      .where(and(eq(permitActions.permitId, permitId), eq(permitActions.tenantId, tenantId)))
      .orderBy(desc(permitActions.createdAt)),
  );
}

export async function updateValidUntil(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  validUntil: Date,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(permits)
    .set({
      validUntil,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${permits.version} + 1`,
    })
    .where(and(eq(permits.id, id), eq(permits.tenantId, tenantId)))
    .returning({ id: permits.id });
  return result.length > 0;
}
