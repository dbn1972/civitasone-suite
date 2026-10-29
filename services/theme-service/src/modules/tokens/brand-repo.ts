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
/**
 * The projected row reaches the consumer through the queue as JSON, so
 * createdAt/updatedAt arrive as ISO strings. drizzle's timestamp column calls
 * .toISOString() on the value, which threw inside the consumer transaction:
 * every brand save / apply-preset dead-lettered with nothing persisted
 * (UAT FQ12 #152 #153). Coerce them back to Dates before writing.
 */
function withDates<T extends { createdAt?: unknown; updatedAt?: unknown }>(row: T): T {
  const out = { ...row };
  if (out.createdAt !== undefined && out.createdAt !== null && !(out.createdAt instanceof Date)) {
    out.createdAt = new Date(out.createdAt as string);
  }
  if (out.updatedAt !== undefined && out.updatedAt !== null && !(out.updatedAt instanceof Date)) {
    out.updatedAt = new Date(out.updatedAt as string);
  }
  return out;
}

export async function insert(tx: Writer, row: BrandConfigInsert): Promise<void> {
  const values = withDates(row);
  const { tenantId: _tenantId, ...rest } = values;
  await tx.insert(brandConfig).values(values).onConflictDoUpdate({ target: brandConfig.tenantId, set: rest });
}

export async function update(tx: Writer, tenantId: string, patch: Partial<BrandConfigInsert>): Promise<void> {
  await tx.update(brandConfig).set(withDates(patch)).where(eq(brandConfig.tenantId, tenantId));
}
