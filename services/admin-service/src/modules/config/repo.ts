import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { adminEditions, adminModuleConfigs, adminFeatureFlags } from "./schema.js";
import type { TenantConfigView } from "./domain.js";
import { resolveFeatureFlag } from "./domain.js";

const PLATFORM = "00000000-0000-0000-0000-000000000000";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function listModuleKeys(tenantId: string): Promise<string[]> {
  const rows = await db.select({ moduleKey: adminModuleConfigs.moduleKey, enabled: adminModuleConfigs.enabled })
    .from(adminModuleConfigs).where(eq(adminModuleConfigs.tenantId, tenantId));
  return rows.filter((r) => r.enabled).map((r) => r.moduleKey);
}

export async function getTenantConfig(tenantId: string): Promise<TenantConfigView | null> {
  const editionRows = await db.select().from(adminEditions).where(eq(adminEditions.tenantId, tenantId)).limit(1);
  const moduleRows = await db.select().from(adminModuleConfigs).where(eq(adminModuleConfigs.tenantId, tenantId));
  const flagRows = await db.select().from(adminFeatureFlags);

  if (!editionRows[0]) return null;

  const modules: Record<string, boolean> = {};
  for (const m of moduleRows) modules[m.moduleKey] = m.enabled;

  const edition = editionRows[0].edition;
  const featureFlags: Record<string, boolean> = {};
  for (const f of flagRows) {
    const tenantOverride = (f.overrides as Record<string, boolean>)[tenantId];
    const editionOverride = (f.overrides as Record<string, boolean>)[edition];
    const layers: import("./domain.js").FlagLayers = { globalEnabled: f.enabled };
    if (editionOverride !== undefined) layers.editionEnabled = editionOverride;
    if (tenantOverride !== undefined) layers.tenantOverride = tenantOverride;
    featureFlags[f.flagKey] = resolveFeatureFlag(layers);
  }

  return { tenantId, edition, modules, featureFlags };
}

export async function upsertModule(tx: Writer, tenantId: string, moduleKey: string, enabled: boolean, actorId: string): Promise<void> {
  const existing = await tx.select().from(adminModuleConfigs)
    .where(and(eq(adminModuleConfigs.tenantId, tenantId), eq(adminModuleConfigs.moduleKey, moduleKey))).limit(1);
  if (existing[0]) {
    await tx.update(adminModuleConfigs).set({ enabled, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(adminModuleConfigs.id, existing[0].id));
  } else {
    await tx.insert(adminModuleConfigs).values({
      tenantId, moduleKey, enabled, createdBy: actorId, updatedBy: actorId,
    });
  }
}

export async function insertFlag(tx: Writer, flagKey: string, enabled: boolean, actorId: string): Promise<void> {
  await tx.insert(adminFeatureFlags).values({
    tenantId: PLATFORM, flagKey, enabled, overrides: {}, createdBy: actorId, updatedBy: actorId,
  });
}

export async function setFlagOverride(tx: Writer, flagKey: string, tenantId: string, enabled: boolean, actorId: string): Promise<void> {
  const rows = await tx.select().from(adminFeatureFlags).where(eq(adminFeatureFlags.flagKey, flagKey)).limit(1);
  if (!rows[0]) throw new Error(`flag ${flagKey} not found`);
  const overrides = { ...(rows[0].overrides as Record<string, boolean>), [tenantId]: enabled };
  await tx.update(adminFeatureFlags).set({ overrides, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(adminFeatureFlags.id, rows[0].id));
}

export async function listFlags(): Promise<Array<{ flagKey: string; enabled: boolean; overrides: Record<string, boolean> }>> {
  const rows = await db.select().from(adminFeatureFlags);
  return rows.map((r) => ({ flagKey: r.flagKey, enabled: r.enabled, overrides: r.overrides as Record<string, boolean> }));
}
