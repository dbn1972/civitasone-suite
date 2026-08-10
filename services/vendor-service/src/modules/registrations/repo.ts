import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { vendorRegistrations, type VendorRegistrationRow, type VendorRegistrationInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<VendorRegistrationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(vendorRegistrations)
      .where(and(eq(vendorRegistrations.id, id), eq(vendorRegistrations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function findByNumber(registrationNumber: string, tenantId: string): Promise<VendorRegistrationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(vendorRegistrations)
      .where(and(eq(vendorRegistrations.registrationNumber, registrationNumber), eq(vendorRegistrations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: VendorRegistrationRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(vendorRegistrations.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(vendorRegistrations.status, opts.status));

  const rows = await scopedRead((tx) =>
    tx.select().from(vendorRegistrations)
      .where(and(...conditions))
      .orderBy(desc(vendorRegistrations.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(vendorRegistrations)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertRegistration(tx: ScopedTx, row: VendorRegistrationInsert): Promise<void> {
  await tx.insert(vendorRegistrations).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(vendorRegistrations)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      submittedAt: status === "submitted" ? new Date() : undefined,
      version: sql`${vendorRegistrations.version} + 1`,
    })
    .where(and(eq(vendorRegistrations.id, id), eq(vendorRegistrations.tenantId, tenantId)))
    .returning({ id: vendorRegistrations.id });
  return result.length > 0;
}

export async function allocateZone(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  zone: string,
  spot: string,
  updatedBy: string,
): Promise<boolean> {
  const result = await tx.update(vendorRegistrations)
    .set({
      status: "zone_allocated",
      allocatedZone: zone,
      allocatedSpot: spot,
      updatedBy,
      updatedAt: new Date(),
      version: sql`${vendorRegistrations.version} + 1`,
    })
    .where(and(eq(vendorRegistrations.id, id), eq(vendorRegistrations.tenantId, tenantId)))
    .returning({ id: vendorRegistrations.id });
  return result.length > 0;
}
