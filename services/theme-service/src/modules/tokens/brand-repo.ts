import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { brandConfig, type BrandConfigInsert, type BrandConfigRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findByTenant(tenantId: string): Promise<BrandConfigRow | null> {
  // brand_config is FORCE ROW LEVEL SECURITY. A bare db.select() carries no
  // app.tenant_id GUC, so it matched zero rows for the non-superuser service
  // role: GET /v1/themes/brand fell back to DEFAULTS once its cache expired
  // and every save after the first computed isCreate=true. Reading inside
  // db.transaction() picks the GUC up from the tenant AsyncLocalStorage.
  const rows = await db.transaction((tx) =>
    tx.select().from(brandConfig).where(eq(brandConfig.tenantId, tenantId)).limit(1),
  );
  return rows[0] ?? null;
}

// Atomic insert-or-update so a stale isCreate (two first saves racing, or a
// redelivered command) cannot violate the brand_config primary key and roll
// back the consumer transaction - which would silently drop the save.
export async function insert(tx: Writer, row: BrandConfigInsert): Promise<void> {
  const { tenantId, ...rest } = row;
  await tx.insert(brandConfig).values(row).onConflictDoUpdate({ target: brandConfig.tenantId, set: rest });
}

export async function update(tx: Writer, tenantId: string, patch: Partial<BrandConfigInsert>): Promise<void> {
  await tx.update(brandConfig).set(patch).where(eq(brandConfig.tenantId, tenantId));
}
