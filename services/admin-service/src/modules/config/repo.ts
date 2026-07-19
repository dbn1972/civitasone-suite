import { eq, and, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import { adminEditions, adminModuleConfigs, adminFeatureFlags } from "./schema.js";
import type { TenantConfigView } from "./domain.js";
import { resolveFeatureFlag } from "./domain.js";

const PLATFORM = "00000000-0000-0000-0000-000000000000";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// Both functions below take an explicit `tenantId` naming the tenant whose
// config is being read. That is NOT necessarily the caller's own ambient
// tenant: super_admin's GET /v1/admin/tenants/:id/config, and the gateway's
// internal (no user JWT) GET /v1/admin/tenants/:id/modules-list, both pass a
// path-param tenantId that can differ from — or with the internal-secret
// path, exist with no ambient tenant context at all. A bare scopedRead()
// sets the RLS GUC from the CALLER's ambient AsyncLocalStorage tenant (or
// none), so it silently reads the WRONG tenant's rows (or zero rows under
// FORCE RLS with no GUC set) for exactly the cross-tenant callers this
// function exists to serve. Explicitly entering runWithTenant(tenantId, ...)
// scopes the RLS GUC to the tenant actually being looked up — the strict
// per-tenant-match policy then passes correctly, no platform-wide bypass
// needed since this is a single specific tenant, not "all tenants".
export async function listModuleKeys(tenantId: string): Promise<string[]> {
  const rows = await runWithTenant(tenantId, () => scopedRead((tx) => tx.select({ moduleKey: adminModuleConfigs.moduleKey, enabled: adminModuleConfigs.enabled })
    .from(adminModuleConfigs).where(eq(adminModuleConfigs.tenantId, tenantId))));
  return rows.filter((r) => r.enabled).map((r) => r.moduleKey);
}

export async function getTenantConfig(tenantId: string): Promise<TenantConfigView | null> {
  const editionRows = await runWithTenant(tenantId, () => scopedRead((tx) => tx.select().from(adminEditions).where(eq(adminEditions.tenantId, tenantId)).limit(1)));
  const moduleRows = await runWithTenant(tenantId, () => scopedRead((tx) => tx.select().from(adminModuleConfigs).where(eq(adminModuleConfigs.tenantId, tenantId))));
  // admin_feature_flags rows are owned by the PLATFORM sentinel tenant (per-tenant
  // overrides live in the jsonb `overrides` column, not as separate rows) — read
  // under the PLATFORM tenant GUC, not the caller's ctx.tenantId, so RLS admits
  // the rows that actually exist. Mirrors the queue-side write path, which
  // already publishes featureFlagCreate with tenantId=PLATFORM.
  const flagRows = await runWithTenant(PLATFORM, () => scopedRead((tx) => tx.select().from(adminFeatureFlags).limit(500)));

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

// P0: feature-flag create must be idempotent at the data layer. A unique index
// on (tenant_id, flag_key) backstops the create; without ON CONFLICT a genuine
// re-create of an existing platform flag (distinct messageId, so markProcessed
// does not dedupe it) raised a unique-violation that poisoned the consumer and
// dead-lettered the command. Treat a re-create of an existing flag as a no-op.
export async function insertFlag(tx: Writer, flagKey: string, enabled: boolean, actorId: string): Promise<void> {
  await tx.insert(adminFeatureFlags).values({
    tenantId: PLATFORM, flagKey, enabled, overrides: {}, createdBy: actorId, updatedBy: actorId,
  }).onConflictDoNothing({ target: [adminFeatureFlags.tenantId, adminFeatureFlags.flagKey] });
}

// Bug found during Phase 4 coverage-gap closure: this is called from the
// admin.feature_flag.override consumer, which (via withTenantConsumer) runs
// with the ambient RLS GUC set to msg.tenantId — i.e. the TARGET tenant
// being overridden, not PLATFORM. But the flag row it needs to read/update
// lives under tenant_id=PLATFORM (see insertFlag/schema.ts). A bare
// tx.select() filtered by the ambient (target-tenant) GUC therefore always
// found zero rows for a PLATFORM-owned flag, threw "flag not found" inside
// the consumer's try/catch, and the override silently never applied — same
// root-cause class as getTenantConfig/listFlags above, which were already
// correctly scoped to PLATFORM; this function was the one missed.
//
// Fixed WITHOUT splitting the consumer's single transaction (workspace hard
// rule: "one consumer handler = one database transaction"): the GUC is
// switched to PLATFORM for the read+update, then explicitly restored to
// `tenantId` before returning, so the audit-event insert that follows in the
// SAME transaction (still scoped to the target tenant) passes its own
// WITH CHECK (tenant_id = current_tenant_id()).
export async function setFlagOverride(tx: Writer, flagKey: string, tenantId: string, enabled: boolean, actorId: string): Promise<void> {
  const t = tx as unknown as { execute: (q: unknown) => Promise<unknown> };
  await t.execute(sql`SELECT set_config('app.tenant_id', ${PLATFORM}, true)`);
  try {
    const rows = await tx.select().from(adminFeatureFlags).where(eq(adminFeatureFlags.flagKey, flagKey)).limit(1);
    if (!rows[0]) throw new Error(`flag ${flagKey} not found`);
    const overrides = { ...(rows[0].overrides as Record<string, boolean>), [tenantId]: enabled };
    await tx.update(adminFeatureFlags).set({ overrides, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(adminFeatureFlags.id, rows[0].id));
  } finally {
    await t.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
  }
}

export async function listFlags(): Promise<Array<{ flagKey: string; enabled: boolean; overrides: Record<string, boolean> }>> {
  // Same PLATFORM-tenant rationale as getTenantConfig above.
  const rows = await runWithTenant(PLATFORM, () => scopedRead((tx) => tx.select().from(adminFeatureFlags).limit(500)));
  return rows.map((r) => ({ flagKey: r.flagKey, enabled: r.enabled, overrides: r.overrides as Record<string, boolean> }));
}
