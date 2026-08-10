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
