/**
 * composition module — persistence (READ + WRITE).
 *
 * Reads/writes are wrapped in runWithTenant(tenantId, () => ...) so the RLS
 * `app.tenant_id` GUC is set for the transaction. The global reference tables
 * (module_registry / org_profile) carry no RLS policy, so the GUC is harmless
 * there and every catalogue row is returned regardless of tenant.
 *
 * Source-of-truth persisted per tenant is only the USER selections
 * (tenant_entitlement.source = 'user'); core + dep are derived by the domain
 * resolver on read, so disabling a module auto-GCs deps no longer required.
 */
import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import { moduleRegistry, orgProfile, moduleBundle, tenantEntitlement, tenantProfile, tenantEnforcementMode } from "./schema.js";
import type { ModuleDef } from "./domain.js";

export interface BundleRow {
  code: string;
  label: string;
  subtitle: string;
  moduleIds: string[];
  sortOrder: number;
}

export interface ProfileRow {
  code: string;
  label: string;
  subtitle: string;
  rulePacks: Record<string, string>;
  terminology: Record<string, string>;
  statutory: Record<string, boolean>;
  reservation: boolean;
  defaultModules: string[];
  sortOrder: number;
}

export async function loadRegistry(tenantId: string): Promise<ModuleDef[]> {
  const rows = await runWithTenant(tenantId, () => scopedRead((tx) => tx.select().from(moduleRegistry)));
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      layer: r.layer,
      isCore: r.isCore,
      hardDeps: r.hardDeps,
      softDeps: r.softDeps,
      screens: r.screens,
      cluster: r.cluster,
      sortOrder: r.sortOrder,
    }))
    .sort((a, b) => a.layer - b.layer || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/** Load the bundle catalogue (global reference data). */
export async function loadBundles(tenantId: string): Promise<BundleRow[]> {
  const rows = await runWithTenant(tenantId, () => scopedRead((tx) => tx.select().from(moduleBundle)));
  return rows
    .map((r) => ({ code: r.code, label: r.label, subtitle: r.subtitle, moduleIds: r.moduleIds, sortOrder: r.sortOrder }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

export async function loadProfiles(tenantId: string): Promise<ProfileRow[]> {
  const rows = await runWithTenant(tenantId, () => scopedRead((tx) => tx.select().from(orgProfile)));
  return rows
    .map((r) => ({
      code: r.code,
      label: r.label,
      subtitle: r.subtitle,
      rulePacks: r.rulePacks,
      terminology: r.terminology,
      statutory: r.statutory,
      reservation: r.reservation,
      defaultModules: r.defaultModules,
      sortOrder: r.sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

export async function getTenantProfileCode(tenantId: string): Promise<string | null> {
  const rows = await runWithTenant(tenantId, () =>
    scopedRead((tx) => tx.select({ code: tenantProfile.profileCode }).from(tenantProfile).where(eq(tenantProfile.tenantId, tenantId)).limit(1)),
  );
  return rows[0]?.code ?? null;
}

export async function getUserModules(tenantId: string): Promise<string[]> {
  const rows = await runWithTenant(tenantId, () =>
    scopedRead((tx) =>
      tx
        .select({ id: tenantEntitlement.moduleId })
        .from(tenantEntitlement)
        .where(and(eq(tenantEntitlement.tenantId, tenantId), eq(tenantEntitlement.source, "user"))),
    ),
  );
  return rows.map((r) => r.id).sort();
}

/** Replace the tenant's user-module selection set (transactional). */
export async function replaceUserModules(tenantId: string, userModuleIds: string[], actorId: string): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx.delete(tenantEntitlement).where(eq(tenantEntitlement.tenantId, tenantId));
      if (userModuleIds.length > 0) {
        await tx.insert(tenantEntitlement).values(
          userModuleIds.map((id) => ({ tenantId, moduleId: id, source: "user", createdBy: actorId })),
        );
      }
    }),
  );
}

/** Apply an org profile: upsert tenant_profile + set user modules to its defaults. */
export async function applyProfile(tenantId: string, profileCode: string, defaultModules: string[], actorId: string): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx
        .insert(tenantProfile)
        .values({ tenantId, profileCode, appliedBy: actorId })
        .onConflictDoUpdate({
          target: tenantProfile.tenantId,
          set: { profileCode, appliedBy: actorId, appliedAt: new Date() },
        });
      await tx.delete(tenantEntitlement).where(eq(tenantEntitlement.tenantId, tenantId));
      if (defaultModules.length > 0) {
        await tx.insert(tenantEntitlement).values(
          defaultModules.map((id) => ({ tenantId, moduleId: id, source: "user", createdBy: actorId })),
        );
      }
    }),
  );
}

/**
 * ST-M01-03 — tx-scoped applier write, used ONLY by the composition consumer
 * (plan-to-composition applier). Replaces the tenant's user-module selection
 * set and, when a profileCode is supplied, upserts tenant_profile — all inside
 * the SAME transaction as the consumer's markProcessed + audit outbox enqueue.
 *
 * The caller is responsible for running this inside runWithTenant(tenantId, …)
 * so the FORCE-RLS tenant tables see the right app.tenant_id GUC.
 *
 * `tx` is the drizzle transaction handle; typed loosely for the same reason the
 * sibling modules' consumers do (the outbox helper's DrizzleTx and drizzle's
 * own PgTransaction do not share a nominal type).
 */
export async function applyPlanTx(
  tx: {
    insert: typeof db.insert;
    delete: typeof db.delete;
  },
  tenantId: string,
  userModuleIds: string[],
  profileCode: string | null,
  actorId: string,
): Promise<void> {
  if (profileCode !== null) {
    await tx
      .insert(tenantProfile)
      .values({ tenantId, profileCode, appliedBy: actorId })
      .onConflictDoUpdate({
        target: tenantProfile.tenantId,
        set: { profileCode, appliedBy: actorId, appliedAt: new Date() },
      });
  }
  await tx.delete(tenantEntitlement).where(eq(tenantEntitlement.tenantId, tenantId));
  if (userModuleIds.length > 0) {
    await tx.insert(tenantEntitlement).values(
      userModuleIds.map((id) => ({ tenantId, moduleId: id, source: "user" as const, createdBy: actorId })),
    );
  }
}

export type EnforcementMode = "off" | "shadow" | "enforce";

/** The profile that is fail-closed from day one (D-ST-23/24, migration 0049). */
export const STANDALONE_PROFILE_CODE = "smarttransfer_standalone";

/**
 * Effective per-tenant module-gating enforcement mode (FF-03, D-ST-24).
 * Resolution order:
 *   1. an explicit tenant_enforcement_mode row wins;
 *   2. else a tenant on the `smarttransfer_standalone` profile ⇒ `enforce`
 *      (fail-closed from provisioning, D-ST-23/24);
 *   3. else `off` — every pre-existing tenant, no behaviour change.
 */
export async function getEffectiveEnforcementMode(tenantId: string): Promise<EnforcementMode> {
  const [explicitRows, profileCode] = await Promise.all([
    runWithTenant(tenantId, () =>
      scopedRead((tx) =>
        tx.select({ mode: tenantEnforcementMode.mode }).from(tenantEnforcementMode).where(eq(tenantEnforcementMode.tenantId, tenantId)).limit(1),
      ),
    ),
    getTenantProfileCode(tenantId),
  ]);
  const explicit = explicitRows[0]?.mode;
  if (explicit === "off" || explicit === "shadow" || explicit === "enforce") return explicit;
  if (profileCode === STANDALONE_PROFILE_CODE) return "enforce";
  return "off";
}

/** Upsert the explicit per-tenant enforcement mode (super-admin control path). */
export async function setEnforcementMode(tenantId: string, mode: EnforcementMode, actorId: string): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await tx
        .insert(tenantEnforcementMode)
        .values({ tenantId, mode, updatedBy: actorId })
        .onConflictDoUpdate({
          target: tenantEnforcementMode.tenantId,
          set: { mode, updatedBy: actorId, updatedAt: new Date() },
        });
    }),
  );
}
