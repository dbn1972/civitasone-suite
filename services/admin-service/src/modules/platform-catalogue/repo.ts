/**
 * platform-catalogue -- cross-tenant READ access. Every query runs under
 * scopedPlatformRead() (app.platform_bypass GUC, migrations 0011 + 0053), which
 * only adds SELECT policies; callers are gated by requireSuperAdmin() first.
 * Only counts and non-secret columns are selected (never secret_ciphertext).
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import { scopedPlatformRead } from "../../shared/db.js";
import { adminTenants } from "../tenants/schema.js";
import { moduleRegistry, orgProfile, tenantEntitlement, tenantProfile } from "../composition/schema.js";
import { integrationSettings } from "../integration-settings/schema.js";
import { REGISTRY, type Provider } from "../integration-settings/providers.js";
import {
  GATEWAY_PROVIDERS, editionEntitlement, tenantOverride, toEditionView, toGatewayView,
  type EditionView, type EntitlementView, type GatewayView, type GatewayAggregate,
} from "./domain.js";

/** Upper bound on tenant-override rows returned in one read. */
export const MAX_OVERRIDE_ROWS = 5000;

export async function listEditions(): Promise<EditionView[]> {
  const [profiles, tenants, applied] = await scopedPlatformRead((tx) => Promise.all([
    tx.select().from(orgProfile).orderBy(asc(orgProfile.sortOrder), asc(orgProfile.code)),
    tx.select({ tenantId: adminTenants.tenantId, edition: adminTenants.edition }).from(adminTenants),
    tx.select({ tenantId: tenantProfile.tenantId, code: tenantProfile.profileCode }).from(tenantProfile),
  ]));
  // A tenant belongs to the profile it onboarded with (composition.tenant_profile); a tenant that was
  // never composed falls back to the edition recorded on its admin_tenants row.
  const appliedBy = new Map(applied.map((a) => [a.tenantId, a.code]));
  const counts = new Map<string, number>();
  for (const t of tenants) {
    const code = appliedBy.get(t.tenantId) ?? t.edition;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return profiles.map((p) => toEditionView(
    { code: p.code, label: p.label, subtitle: p.subtitle, defaultModules: p.defaultModules },
    counts.get(p.code) ?? 0,
  ));
}

export async function listEntitlements(): Promise<{ rows: EntitlementView[]; truncated: boolean }> {
  const [profiles, modules, overrides] = await scopedPlatformRead((tx) => Promise.all([
    tx.select().from(orgProfile).orderBy(asc(orgProfile.sortOrder), asc(orgProfile.code)),
    tx.select({ id: moduleRegistry.id, name: moduleRegistry.name }).from(moduleRegistry),
    tx.select({
      tenantId: tenantEntitlement.tenantId,
      moduleId: tenantEntitlement.moduleId,
      tenantName: adminTenants.name,
      edition: sql<string>`coalesce(${tenantProfile.profileCode}, ${adminTenants.edition})`,
    })
      .from(tenantEntitlement)
      .innerJoin(adminTenants, eq(adminTenants.tenantId, tenantEntitlement.tenantId))
      .leftJoin(tenantProfile, eq(tenantProfile.tenantId, tenantEntitlement.tenantId))
      .where(inArray(tenantEntitlement.source, ["user", "grandfather"]))
      .orderBy(asc(adminTenants.name), asc(tenantEntitlement.moduleId))
      .limit(MAX_OVERRIDE_ROWS + 1),
  ]));
  const nameOf = new Map(modules.map((m) => [m.id, m.name]));
  const defaults = new Map(profiles.map((p) => [p.code, new Set(p.defaultModules)]));
  const rows: EntitlementView[] = [];
  for (const p of profiles) {
    for (const id of p.defaultModules) rows.push(editionEntitlement(p.code, id, nameOf.get(id) ?? id));
  }
  const truncated = overrides.length > MAX_OVERRIDE_ROWS;
  for (const o of overrides.slice(0, MAX_OVERRIDE_ROWS)) {
    // A module the edition of the tenant already grants is not an override.
    if (defaults.get(o.edition)?.has(o.moduleId)) continue;
    rows.push(tenantOverride(o.edition, o.moduleId, nameOf.get(o.moduleId) ?? o.moduleId, o.tenantId, o.tenantName));
  }
  return { rows, truncated };
}

export async function listGateways(): Promise<GatewayView[]> {
  const keys: string[] = GATEWAY_PROVIDERS.map((g) => g.provider);
  const agg = await scopedPlatformRead((tx) => tx.select({
    provider: integrationSettings.provider,
    enabled: sql<number>`count(*) filter (where ${integrationSettings.enabled})::int`,
    connected: sql<number>`count(*) filter (where ${integrationSettings.enabled} and ${integrationSettings.status} = 'connected')::int`,
    failed: sql<number>`count(*) filter (where ${integrationSettings.enabled} and ${integrationSettings.status} = 'failed')::int`,
    lastTestedAt: sql<string | null>`max(${integrationSettings.lastTestedAt})`,
  }).from(integrationSettings).where(inArray(integrationSettings.provider, keys)).groupBy(integrationSettings.provider));
  const byProvider = new Map(agg.map((a) => [a.provider, a]));
  return GATEWAY_PROVIDERS.map((g) => {
    const a = byProvider.get(g.provider);
    const aggregate: GatewayAggregate = {
      enabled: a?.enabled ?? 0,
      connected: a?.connected ?? 0,
      failed: a?.failed ?? 0,
      lastTestedAt: a?.lastTestedAt ? new Date(a.lastTestedAt) : null,
    };
    return toGatewayView(g.type, g.provider, REGISTRY[g.provider as Provider].label, aggregate);
  });
}
