import { eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { tenantBranding, type TenantBrandingRow, type TenantBrandingInsert, type TenantBrandingView } from "./schema.js";

function toView(r: TenantBrandingRow): TenantBrandingView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    logoS3Key: r.logoS3Key,
    faviconS3Key: r.faviconS3Key,
    appName: r.appName,
    primaryColor: r.primaryColor,
    accentColor: r.accentColor,
    footerText: r.footerText,
    version: r.version,
  };
}

export async function findByTenant(tenantId: string): Promise<TenantBrandingView | null> {
  const rows = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return toView(row);
}

/**
 * Raw-row lookup for the upsert command handler (see branding/commands.ts),
 * which needs the full row — id, createdAt, createdBy, version — to decide
 * insert vs. update and to preserve those fields across an update. Separate
 * from findByTenant() above so that function's public API-response shape
 * (TenantBrandingView) is unaffected.
 */
export async function findRowByTenant(tenantId: string): Promise<TenantBrandingRow | null> {
  const rows = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

export async function findById(id: string, tenantId: string): Promise<TenantBrandingView | null> {
  const rows = await db.select().from(tenantBranding).where(eq(tenantBranding.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<TenantBrandingView[]> {
  const rows = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(limit).offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: TenantBrandingInsert): Promise<void> {
  await tx.insert(tenantBranding).values(row);
}

export async function update(tx: Writer, tenantId: string, patch: Partial<TenantBrandingInsert>): Promise<void> {
  await tx.update(tenantBranding).set(patch).where(eq(tenantBranding.tenantId, tenantId));
}

/**
 * GAP2-TENANT-BRANDING-RACE-06: a single atomic write that is correct even when
 * two concurrent FIRST-EVER saves for the same tenant race. The prior
 * insert-vs-update branch keyed off a stale `isCreate` read taken before the
 * command was published, so both racers could carry isCreate:true and the
 * second INSERT violated UNIQUE(tenant_id), rolling back the whole transaction
 * (including markProcessed) and silently dropping the second save.
 *
 * `INSERT ... ON CONFLICT (tenant_id) DO UPDATE` lets whichever write loses the
 * insert race fall through to an UPDATE in the same statement — one insert, one
 * update, nothing dropped, no reliance on `isCreate`. The id/tenantId/created*
 * columns are preserved from the existing row on the UPDATE path (EXCLUDED is
 * the would-be-inserted row; we deliberately do NOT overwrite the original
 * identity/creation audit columns).
 */
export async function upsertByTenant(tx: Writer, row: TenantBrandingInsert): Promise<void> {
  // Columns to carry onto an existing row on conflict. Omit `undefined` values
  // (exactOptionalPropertyTypes) — a projected row always fills these, but the
  // Insert type marks defaulted columns optional. id/tenantId/created* are
  // deliberately NOT overwritten (the original identity/creation audit stays).
  const set: Record<string, unknown> = {
    logoS3Key: row.logoS3Key ?? null,
    faviconS3Key: row.faviconS3Key ?? null,
    footerText: row.footerText ?? null,
    customEmailFrom: row.customEmailFrom ?? null,
    customLoginHtml: row.customLoginHtml ?? null,
    updatedAt: row.updatedAt ?? new Date(),
    updatedBy: row.updatedBy,
    // Bump from the row that actually exists, not the (possibly stale)
    // projected version — a racing first-save may carry version:1.
    version: sql`${tenantBranding.version} + 1`,
  };
  if (row.appName !== undefined) set.appName = row.appName;
  if (row.primaryColor !== undefined) set.primaryColor = row.primaryColor;
  if (row.accentColor !== undefined) set.accentColor = row.accentColor;
  if (row.poweredByHidden !== undefined) set.poweredByHidden = row.poweredByHidden;

  await (tx as typeof db)
    .insert(tenantBranding)
    .values(row)
    .onConflictDoUpdate({ target: tenantBranding.tenantId, set });
}

export { toView };
