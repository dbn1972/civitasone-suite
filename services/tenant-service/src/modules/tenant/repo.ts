/**
 * tenant repo — Drizzle queries against `tenant.*` ONLY (L2).
 * READS are used by the query path (always behind the cache).
 * WRITES are used ONLY by the consumer, inside the outbox transaction.
 */
import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { tenants, type TenantRow, type TenantInsert } from "./schema.js";
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
    settings: r.settings,
    version: r.version,
  };
}

// ── reads (query path) ───────────────────────────────────────────────
export async function findById(id: string): Promise<TenantView | null> {
  const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function findByDomain(domain: string): Promise<TenantView | null> {
  const rows = await db.select().from(tenants).where(eq(tenants.domain, domain)).limit(1);
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
