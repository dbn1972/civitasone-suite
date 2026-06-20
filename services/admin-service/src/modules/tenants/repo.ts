import { eq, desc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
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

export async function findById(id: string): Promise<TenantView | null> {
  const rows = await db.select().from(adminTenants).where(eq(adminTenants.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function list(page: number, limit: number): Promise<{ items: TenantView[]; total: number }> {
  const offset = (page - 1) * limit;
  const [rows, countRows] = await Promise.all([
    db.select().from(adminTenants).orderBy(desc(adminTenants.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(adminTenants),
  ]);
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
