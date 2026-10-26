/**
 * Tenant federation topology (District Governance Platform, Wave-A EPIC-3 T3.1).
 *
 * The Ministry -> State -> Division -> District -> Department tenant tree is
 * recorded via tenant.tenants.parent_tenant_id and resolved by the control-plane
 * SECURITY DEFINER functions tenant.tenant_ancestry / tenant.tenant_descendants
 * (migration 0016). These are the ONLY sanctioned cross-tenant-tree reads —
 * normal OLTP never reads child rows; state/ministry dashboards read analytics
 * projections, never child OLTP (per the review's data-ownership rule).
 */
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";

export interface TenantNode {
  id: string;
  name: string;
  govLevel: string | null;
  parentTenantId: string | null;
  depth: number;
}

function rowToNode(r: Record<string, unknown>): TenantNode {
  return {
    id: String(r.id),
    name: String(r.name),
    govLevel: r.gov_level == null ? null : String(r.gov_level),
    parentTenantId: r.parent_tenant_id == null ? null : String(r.parent_tenant_id),
    depth: Number(r.depth),
  };
}

/** The chain from `tenantId` UP to its root (root first). */
export async function resolveAncestry(tenantId: string): Promise<TenantNode[]> {
  const res = await db.execute(sql`SELECT id, name, gov_level, parent_tenant_id, depth FROM tenant.tenant_ancestry(${tenantId}::uuid)`);
  return (res as unknown as { rows: Array<Record<string, unknown>> }).rows.map(rowToNode);
}

/** Every tenant BELOW `tenantId` (for aggregation scoping). */
export async function resolveDescendants(tenantId: string): Promise<TenantNode[]> {
  const res = await db.execute(sql`SELECT id, name, gov_level, parent_tenant_id, depth FROM tenant.tenant_descendants(${tenantId}::uuid)`);
  return (res as unknown as { rows: Array<Record<string, unknown>> }).rows.map(rowToNode);
}

/**
 * Render an ancestry chain as a readable path, root first. Pure — unit-tested.
 * e.g. "Ministry of Rural Development > State of Odisha > Khordha District".
 */
export function formatChain(chain: TenantNode[]): string {
  return [...chain].sort((a, b) => b.depth - a.depth).map((n) => n.name).join(" > ");
}

// ── platform-admin directory (cross-tenant by nature) ────────────────────────
export interface TenantDirectoryRow {
  id: string;
  name: string;
  domain: string;
  edition: string;
  status: string;
  region: string;
  residency: string;
  isolationTier: string;
  createdDate: string;
}

/**
 * Cross-tenant paginated directory via the SECURITY DEFINER function from
 * migration 0030 (the module's control-plane path; RLS on tenant.tenants stays
 * FORCE). CALLERS MUST have role-gated and audited: see GET /v1/tenants.
 */
export async function listAllTenants(opts: { q: string | null; limit: number; offset: number }): Promise<{ rows: TenantDirectoryRow[]; total: number }> {
  const res = await db.execute(sql`SELECT * FROM tenant.list_tenants_admin(${opts.q}::text, ${opts.limit}::int, ${opts.offset}::int)`);
  const raw: Array<Record<string, unknown>> = Array.isArray(res)
    ? (res as unknown as Array<Record<string, unknown>>)
    : (res as unknown as { rows: Array<Record<string, unknown>> }).rows;
  const rows = raw.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    domain: String(r.domain),
    edition: String(r.edition),
    status: String(r.status),
    region: String(r.region),
    residency: String(r.residency),
    isolationTier: String(r.isolation_tier),
    createdDate: new Date(r.created_at as string | Date).toISOString(),
  }));
  return { rows, total: raw.length ? Number(raw[0]!.total) : 0 };
}
