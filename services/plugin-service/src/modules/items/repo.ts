import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { items, type ItemRow, type ItemInsert, type ItemView } from "./schema.js";

function toView(r: ItemRow): ItemView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    semver: r.semver,
    description: r.description,
    status: r.status,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<ItemView | null> {
  const rows = await db.select().from(items).where(eq(items.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<ItemView[]> {
  const rows = await db.select().from(items).where(eq(items.tenantId, tenantId)).limit(limit).offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: ItemInsert): Promise<void> {
  await tx.insert(items).values(row);
}

export { toView };
