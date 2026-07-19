import { eq, desc, sql } from "drizzle-orm";
import { db, scopedPlatformRead } from "../../shared/db.js";
import { adminTenants, type AdminTenantInsert, type AdminTenantRow } from "./schema.js";
import type { TenantView } from "./domain.js";

function toView(r: AdminTenantRow): TenantView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    domain: r.domain,
    edition: r.edition as TenantView["edition"],
    status: r.status as TenantView["status"],
    region: r.region,
    residency: r.residency,
    settings: r.settings,
    version: r.version,
  };
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// Platform-wide admin lookup (super_admin/platform_admin only, enforced at the
// route layer via requireSuperAdmin) — intentionally not scoped to a single
// tenant, since this is the cross-tenant tenant-management view. Per-request
// RLS is normally scoped to the CALLER's own JWT tenant (see app.ts's
// onRequest hook), which would silently filter this cross-tenant read down to
// just the caller's tenant. scopedPlatformRead() sets the app.platform_bypass
// GUC (migration 0011's additional permissive SELECT policy) so this
// genuinely platform-wide query sees every tenant's row.
export async function findById(id: string): Promise<TenantView | null> {
  const rows = await scopedPlatformRead((tx) => tx.select().from(adminTenants).where(eq(adminTenants.id, id)).limit(1));
  return rows[0] ? toView(rows[0]) : null;
}

// Platform-wide admin listing — see findById's comment on scope + scopedPlatformRead.
export async function list(page: number, limit: number): Promise<{ items: TenantView[]; total: number }> {
  const offset = (page - 1) * limit;
  const [rows, countRows] = await scopedPlatformRead((tx) => Promise.all([
    tx.select().from(adminTenants).orderBy(desc(adminTenants.createdAt)).limit(limit).offset(offset),
    tx.select({ count: sql<number>`count(*)::int` }).from(adminTenants),
  ]));
  return { items: rows.map(toView), total: countRows[0]?.count ?? 0 };
}

export async function insert(tx: Writer, row: AdminTenantInsert): Promise<void> {
  await tx.insert(adminTenants).values(row);
}

export async function update(tx: Writer, id: string, patch: Partial<AdminTenantInsert>): Promise<void> {
  await tx.update(adminTenants).set({ ...patch, updatedAt: new Date() }).where(eq(adminTenants.id, id));
}

export async function findByIdTx(tx: Writer, id: string): Promise<TenantView | null> {
  const rows = await tx.select().from(adminTenants).where(eq(adminTenants.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}
