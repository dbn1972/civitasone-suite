import { eq } from "drizzle-orm";
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

export { toView };
