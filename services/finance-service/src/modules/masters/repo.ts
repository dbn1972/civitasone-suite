import { and, asc, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { financePao, financeDdo, financeVendors, type PaoRow, type DdoRow, type VendorRow } from "./schema.js";

export type Reader = Pick<typeof db, "select">;

export async function listPao(tenantId: string, limit = 500): Promise<PaoRow[]> {
  return scopedRead((tx) => tx.select().from(financePao)
    .where(eq(financePao.tenantId, tenantId))
    .orderBy(asc(financePao.paoCode))
    .limit(limit));
}

export async function listDdo(tenantId: string, limit = 500): Promise<DdoRow[]> {
  return scopedRead((tx) => tx.select().from(financeDdo)
    .where(eq(financeDdo.tenantId, tenantId))
    .orderBy(asc(financeDdo.ddoCode))
    .limit(limit));
}

export async function listVendors(tenantId: string, limit = 500): Promise<VendorRow[]> {
  return scopedRead((tx) => tx.select().from(financeVendors)
    .where(eq(financeVendors.tenantId, tenantId))
    .orderBy(asc(financeVendors.name))
    .limit(limit));
}

export async function getVendorById(tenantId: string, id: string): Promise<VendorRow | null> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(financeVendors)
      .where(and(eq(financeVendors.tenantId, tenantId), eq(financeVendors.id, id)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export type VendorWriteInput = {
  name: string;
  category: string;
  pan: string;
  gstin: string | null;
  address: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  bankName: string;
  bankAccountNo: string;
  ifsc: string;
};

// Partial<VendorWriteInput> isn't used for the patch shape: under this repo's
// exactOptionalPropertyTypes:true, `Partial<T>`'s `prop?: T` forbids an
// explicitly-`undefined` value, but the route layer passes the object
// spread from a zod .optional()-parsed body, whose fields are statically
// `T | undefined` (key present-with-undefined and key-absent aren't
// distinguished by zod's inferred type). This mirrors that shape directly.
export type VendorPatch = {
  name?: string | undefined;
  category?: string | undefined;
  gstin?: string | null | undefined;
  address?: string | undefined;
  contactPerson?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  bankName?: string | undefined;
  bankAccountNo?: string | undefined;
  ifsc?: string | undefined;
  isActive?: boolean | undefined;
};

export async function createVendor(tenantId: string, input: VendorWriteInput, actorId: string): Promise<VendorRow> {
  // Must go through db.transaction() (not a bare db.insert()) — that's the
  // only path that sets the app.tenant_id GUC financeVendors' FORCE ROW
  // LEVEL SECURITY policy checks. An unwrapped insert sees tenant_id as
  // NULL under the policy and is rejected by Postgres on every call. Mirrors
  // updateVendor() below.
  return db.transaction(async (tx) => {
    const rows = await tx.insert(financeVendors).values({
      tenantId,
      ...input,
      isActive: true,
      version: 1,
      createdBy: actorId,
      updatedBy: actorId,
    }).returning();
    const row = rows[0];
    if (!row) throw new Error("VENDOR_INSERT_FAILED: insert returned no row");
    return row;
  });
}

/**
 * FINDING (surfaced now that vendor creation is unblocked — see PII_ENC_KEY
 * fix): financeVendors has UNIQUE (tenant_id, pan) (0065_vendor_master.sql),
 * but createVendor did no pre-check and let a violation propagate as a raw
 * PostgresError, 500ing instead of a clean 409. Mirrors the isUniqueViolation
 * idiom already used in court-service (modules/config-registry/repo.ts,
 * modules/cause-list/repo.ts) — masters/routes.ts's POST /v1/finance/vendors
 * catches this and throws HttpError(409, "DUPLICATE_PAN", ...).
 */
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code;
  return code === "23505" || code === "23P01";
}

/**
 * Optimistic-concurrency update, mirroring the guarded-UPDATE idiom in
 * modules/instruments/repo.ts's transition() (version bumped via
 * `sql\`${col} + 1\``, WHERE pins tenant + id + a guard condition). Here the
 * guard is the caller-supplied expectedVersion rather than a status set:
 * vendors have no state machine, just optimistic locking on plain field
 * edits. Returns null when the guard doesn't match (no such vendor for this
 * tenant, or a stale version) — the route layer disambiguates 404 vs 409 by
 * checking existence first.
 */
/**
 * Strips undefined-valued keys so the object matches drizzle's generated
 * .set() parameter type under this repo's exactOptionalPropertyTypes:true
 * (which forbids an explicitly-undefined value on a `prop?: T` field).
 * VendorPatch's fields are typed `T | undefined` because they come straight
 * from a zod .optional()-parsed body, where "key absent" and "key present
 * with undefined" aren't distinguished statically. This also happens to be
 * exactly the right runtime behavior for a PATCH: only fields the caller
 * actually supplied should touch the row.
 */
function definedOnly<T extends object>(obj: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

export async function updateVendor(
  tenantId: string,
  id: string,
  expectedVersion: number,
  patch: VendorPatch,
  actorId: string,
): Promise<VendorRow | null> {
  return db.transaction(async (tx) => {
    const updated = await tx.update(financeVendors)
      .set({
        ...definedOnly(patch),
        updatedBy: actorId,
        updatedAt: new Date(),
        version: sql`${financeVendors.version} + 1`,
      })
      .where(and(
        eq(financeVendors.tenantId, tenantId),
        eq(financeVendors.id, id),
        eq(financeVendors.version, expectedVersion),
      ))
      .returning();
    return updated[0] ?? null;
  });
}

export async function paoExists(tenantId: string, code: string, reader: Reader = db): Promise<boolean> {
  const r = reader as typeof db;
  const rows = await r.select({ id: financePao.id }).from(financePao)
    .where(and(eq(financePao.tenantId, tenantId), eq(financePao.paoCode, code), eq(financePao.isActive, true)))
    .limit(1);
  return rows.length > 0;
}

export async function ddoExists(tenantId: string, code: string, reader: Reader = db): Promise<boolean> {
  const r = reader as typeof db;
  const rows = await r.select({ id: financeDdo.id }).from(financeDdo)
    .where(and(eq(financeDdo.tenantId, tenantId), eq(financeDdo.ddoCode, code), eq(financeDdo.isActive, true)))
    .limit(1);
  return rows.length > 0;
}

/**
 * BUG FIX (bill->vendor reference validation): mirrors ddoExists/paoExists
 * above — a tenant-scoped, tx-participating existence check. Previously a
 * bill's vendorId only got a UUID-format check (Zod) with no existence/tenant
 * lookup, so a bill citing a vendor that doesn't exist anywhere (or belongs to
 * a different tenant) was accepted, approved and paid with no error.
 */
export async function vendorExists(tenantId: string, id: string, reader: Reader = db): Promise<boolean> {
  const r = reader as typeof db;
  const rows = await r.select({ id: financeVendors.id }).from(financeVendors)
    .where(and(eq(financeVendors.tenantId, tenantId), eq(financeVendors.id, id), eq(financeVendors.isActive, true)))
    .limit(1);
  return rows.length > 0;
}
