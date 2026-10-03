import { and, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsPolicySettings } from "./schema.js";
import { resolvePolicy, POLICY_KEYS, type PolicyKey, type PolicyValue } from "./registry.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** Effective value for one key (stored over default). Read-only, tenant-scoped. */
export async function getPolicy<K extends PolicyKey>(tenantId: string, key: K): Promise<PolicyValue<K>> {
  const rows = await scopedRead((tx) => tx.select({ value: hrmsPolicySettings.value }).from(hrmsPolicySettings)
    .where(and(eq(hrmsPolicySettings.tenantId, tenantId), eq(hrmsPolicySettings.key, key))).limit(1));
  return resolvePolicy(key, rows[0]?.value);
}

/** Every key's effective value, plus whether it is customised (a stored row exists). */
export async function listPolicies(tenantId: string): Promise<Array<{ key: PolicyKey; value: unknown; isDefault: boolean }>> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsPolicySettings).where(eq(hrmsPolicySettings.tenantId, tenantId)));
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  return POLICY_KEYS.map((key) => ({ key, value: resolvePolicy(key, stored.get(key)), isDefault: !stored.has(key) }));
}

export async function upsertPolicy(tx: Writer, tenantId: string, key: PolicyKey, value: unknown, actorId: string): Promise<void> {
  await tx.insert(hrmsPolicySettings).values({ tenantId, key, value: value as object, updatedBy: actorId })
    .onConflictDoUpdate({
      target: [hrmsPolicySettings.tenantId, hrmsPolicySettings.key],
      set: { value: value as object, updatedBy: actorId, updatedAt: new Date(), version: sql`${hrmsPolicySettings.version} + 1` },
    });
}
