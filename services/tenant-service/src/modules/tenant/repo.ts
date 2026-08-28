/**
 * tenant repo — Drizzle queries against `tenant.*` ONLY (L2).
 * READS are used by the query path (always behind the cache).
 * WRITES are used ONLY by the consumer, inside the outbox transaction.
 */
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { tenants, tenantQuotas, type TenantRow, type TenantInsert, type TenantQuotaRow } from "./schema.js";
import type { TenantView } from "./domain.js";

function toView(r: TenantRow): TenantView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    domain: r.domain,
    edition: r.edition as TenantView["edition"],
    status: r.status as TenantView["status"],
    region: r.region,
    residency: r.residency,
    isolationTier: (r.isolationTier as TenantView["isolationTier"]) ?? "pool",
    policyVersion: r.policyVersion ?? null,
    policyReason: (r.policyReason as TenantView["policyReason"]) ?? null,
    settings: r.settings,
    version: r.version,
  };
}

// ── reads (query path) ───────────────────────────────────────────────
/**
 * TENANT-SCOPING FIX (deep-verification, 2026-08-27): tenant.tenants has had
 * FORCE ROW LEVEL SECURITY since migration 0003, and migration 0010 removed
 * the earlier "OR current_tenant_id() IS NULL" super-admin escape hatch
 * (world-class-closure hardening) -- the live policy is now strictly
 * `tenant_id = tenant.current_tenant_id()`. These two functions used to query
 * via a bare db.select(), which never sets the app.tenant_id GUC (only
 * db.transaction() does, via wrapWithTenantGuc) -- so with no escape hatch
 * left, they matched ZERO rows for every call, every tenant, always. Live-
 * confirmed: GET /v1/tenants/:tenantId 404'd for a tenant id verified to
 * exist in the table via a direct superuser query. The existing tests never
 * caught this because they only assert the not-found path (comments read
 * "won't exist" / "if it existed") -- none ever inserted a real row and
 * fetched it back. tenantScoped() (below) is the exact fix already used
 * correctly elsewhere in this same file for tenant.tenant_quotas.
 */
export async function findById(id: string): Promise<TenantView | null> {
  const rows = await tenantScoped(id, (tx) =>
    (tx as unknown as typeof db).select().from(tenants).where(eq(tenants.id, id)).limit(1),
  );
  return rows[0] ? toView(rows[0]) : null;
}

/**
 * `tenantId` must be the caller's OWN tenant id (the RLS scope) -- this can
 * never be used to resolve an unknown caller's tenant purely from a domain
 * string, the same way findById can't resolve an id it doesn't already trust.
 * See TENANT-SCOPING FIX note above.
 */
export async function findByDomain(tenantId: string, domain: string): Promise<TenantView | null> {
  const rows = await tenantScoped(tenantId, (tx) =>
    (tx as unknown as typeof db).select().from(tenants).where(eq(tenants.domain, domain)).limit(1),
  );
  return rows[0] ? toView(rows[0]) : null;
}

// ── writes (consumer only, within a tx) ──────────────────────────────
/** Minimal writer surface satisfied by both `db` and a Drizzle transaction. */
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: TenantInsert): Promise<void> {
  await tx.insert(tenants).values(row);
}

export async function update(tx: Writer, id: string, patch: Partial<TenantInsert>): Promise<void> {
  await tx.update(tenants).set({ ...patch, updatedAt: new Date() }).where(eq(tenants.id, id));
}

export async function findByIdTx(tx: Writer, id: string): Promise<TenantView | null> {
  const rows = await tx.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export { toView };

// ── quota reads/writes ───────────────────────────────────────────────

export interface TenantQuotaView {
  tenantId: string;
  maxEmployees: number;
  maxFiles: number;
  maxApiCallsPerMin: number;
  maxStorageGb: number;
  maxUsers: number;
  createdAt: Date;
  updatedAt: Date;
}

function quotaToView(r: TenantQuotaRow): TenantQuotaView {
  return {
    tenantId: r.tenantId,
    maxEmployees: r.maxEmployees,
    maxFiles: r.maxFiles,
    maxApiCallsPerMin: r.maxApiCallsPerMin,
    maxStorageGb: r.maxStorageGb,
    maxUsers: r.maxUsers,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Default quotas returned when no row exists for a tenant. */
const DEFAULT_QUOTAS: Omit<TenantQuotaView, "tenantId" | "createdAt" | "updatedAt"> = {
  maxEmployees: 500,
  maxFiles: 10000,
  maxApiCallsPerMin: 200,
  maxStorageGb: 10,
  maxUsers: 100,
};

/**
 * Run fn inside a tenant-scoped transaction. RLS on tenant.tenant_quotas
 * requires the app.tenant_id GUC to be set (via wrapWithTenantGuc, which only
 * intercepts db.transaction() calls — bare db.select()/insert()/update() are
 * never GUC-scoped), so every quotas read/write goes through this helper.
 */
async function tenantScoped<T>(tenantId: string, fn: (tx: Writer) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction((tx) => fn(tx as unknown as Writer)));
}

export async function findQuotas(tenantId: string): Promise<TenantQuotaView> {
  const rows = await tenantScoped(tenantId, (tx) =>
    tx.select().from(tenantQuotas).where(eq(tenantQuotas.tenantId, tenantId)).limit(1),
  );
  if (rows[0]) return quotaToView(rows[0]);
  // Return defaults when no explicit quotas exist
  const now = new Date();
  return { tenantId, ...DEFAULT_QUOTAS, createdAt: now, updatedAt: now };
}

export async function upsertQuotas(tenantId: string, patch: Partial<{ maxEmployees: number | undefined; maxFiles: number | undefined; maxApiCallsPerMin: number | undefined; maxStorageGb: number | undefined; maxUsers: number | undefined }>): Promise<TenantQuotaView> {
  const now = new Date();
  // Strip undefined values to satisfy exactOptionalPropertyTypes
  const cleanPatch: Record<string, number> = {};
  if (patch.maxEmployees !== undefined) cleanPatch.maxEmployees = patch.maxEmployees;
  if (patch.maxFiles !== undefined) cleanPatch.maxFiles = patch.maxFiles;
  if (patch.maxApiCallsPerMin !== undefined) cleanPatch.maxApiCallsPerMin = patch.maxApiCallsPerMin;
  if (patch.maxStorageGb !== undefined) cleanPatch.maxStorageGb = patch.maxStorageGb;
  if (patch.maxUsers !== undefined) cleanPatch.maxUsers = patch.maxUsers;

  await tenantScoped(tenantId, async (tx) => {
    const existing = await tx.select().from(tenantQuotas).where(eq(tenantQuotas.tenantId, tenantId)).limit(1);
    if (existing[0]) {
      await tx.update(tenantQuotas)
        .set({ ...cleanPatch, updatedAt: now })
        .where(eq(tenantQuotas.tenantId, tenantId));
    } else {
      await tx.insert(tenantQuotas).values({
        tenantId,
        maxEmployees: cleanPatch.maxEmployees ?? DEFAULT_QUOTAS.maxEmployees,
        maxFiles: cleanPatch.maxFiles ?? DEFAULT_QUOTAS.maxFiles,
        maxApiCallsPerMin: cleanPatch.maxApiCallsPerMin ?? DEFAULT_QUOTAS.maxApiCallsPerMin,
        maxStorageGb: cleanPatch.maxStorageGb ?? DEFAULT_QUOTAS.maxStorageGb,
        maxUsers: cleanPatch.maxUsers ?? DEFAULT_QUOTAS.maxUsers,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  return findQuotas(tenantId);
}
