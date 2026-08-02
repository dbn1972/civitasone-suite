import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { brandConfig, type BrandConfigInsert, type BrandConfigRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findByTenant(tenantId: string): Promise<BrandConfigRow | null> {
  const rows = await db.select().from(brandConfig).where(eq(brandConfig.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

export async function insert(tx: Writer, row: BrandConfigInsert): Promise<void> {
  await tx.insert(brandConfig).values(row);
}

export async function update(tx: Writer, tenantId: string, patch: Partial<BrandConfigInsert>): Promise<void> {
  await tx.update(brandConfig).set(patch).where(eq(brandConfig.tenantId, tenantId));
}
