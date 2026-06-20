import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { tokens, type TokenRow, type TokenInsert, type TokenView } from "./schema.js";

function toView(r: TokenRow): TokenView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    value: r.value,
    category: r.category,
    status: r.status,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<TokenView | null> {
  const rows = await db.select().from(tokens).where(eq(tokens.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<TokenView[]> {
  const rows = await db.select().from(tokens).where(eq(tokens.tenantId, tenantId)).limit(limit).offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: TokenInsert): Promise<void> {
  await tx.insert(tokens).values(row);
}

export { toView };
