/**
 * org-hierarchy-levels repository -- the only module that queries
 * `org_hierarchy_levels.*` directly (L2 rule).
 *
 * COMP-014: resolves a tenant's configured hierarchy-level taxonomy, falling
 * back to the platform default (seeded by migration 0033) for a tenant that
 * has never configured any override of its own -- mirrors payroll-service's
 * statutory.statutory_config / payroll.tax_slab_config tenant-override
 * pattern (DOM-008, migrations 0038/0039 there; 0033 here) exactly: the
 * SELECT sees both the caller's own rows and the sentinel platform-default
 * rows under RLS (tenant_isolation_policy + the additive
 * platform_default_read_policy, both added by migration 0033), and
 * resolution picks the tenant's own set if non-empty, else the platform
 * default's set.
 */
import { and, eq, inArray } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { orgHierarchyLevels, type OrgHierarchyLevelRow } from "./schema.js";

export const PLATFORM_DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Pure resolution over rows already fetched for this tenant (its own rows +
 * the platform-default sentinel rows -- exactly what the RLS-scoped SELECT
 * in fetchLevelsForTenant() below returns). Exported unwrapped from the DB
 * call so the "tenant wins, else platform default" rule can be unit-tested
 * without a database.
 */
export function resolveLevels(rows: OrgHierarchyLevelRow[], tenantId: string): OrgHierarchyLevelRow[] {
  const own = rows.filter((r) => r.tenantId === tenantId);
  const chosen = own.length > 0 ? own : rows.filter((r) => r.tenantId === PLATFORM_DEFAULT_TENANT_ID);
  return chosen.slice().sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function fetchLevelsForTenant(tenantId: string): Promise<OrgHierarchyLevelRow[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(orgHierarchyLevels).where(inArray(orgHierarchyLevels.tenantId, [tenantId, PLATFORM_DEFAULT_TENANT_ID])),
  );
  return resolveLevels(rows, tenantId);
}

export type LevelInput = {
  id: string; // level_key -- stable across reorders, matches the frontend's OrgLevel.id
  order: number;
  label: string;
  description: string;
  examples: string;
  color: string;
};

/**
 * Full-replace: the tenant's own level set becomes EXACTLY `levels` (delete
 * any of the tenant's rows not present in the new set, then upsert every
 * incoming row keyed on (tenant_id, level_key)), all inside one transaction.
 * Never touches the platform-default rows -- the strict
 * tenant_isolation_policy's WITH CHECK (migration 0033) makes writing the
 * sentinel tenant_id impossible from a real tenant's request context
 * regardless of what this function does.
 */
export async function replaceLevelsForTenant(
  tenantId: string,
  levels: LevelInput[],
  actorId: string | undefined,
): Promise<OrgHierarchyLevelRow[]> {
  return scopedRead(async (tx) => {
    const keepKeys = new Set(levels.map((l) => l.id));
    const existing = await tx.select().from(orgHierarchyLevels).where(eq(orgHierarchyLevels.tenantId, tenantId));
    for (const row of existing) {
      if (!keepKeys.has(row.levelKey)) {
        await tx.delete(orgHierarchyLevels)
          .where(and(eq(orgHierarchyLevels.tenantId, tenantId), eq(orgHierarchyLevels.levelKey, row.levelKey)));
      }
    }
    for (const l of levels) {
      await tx.insert(orgHierarchyLevels)
        .values({
          tenantId,
          levelKey: l.id,
          sortOrder: l.order,
          label: l.label,
          description: l.description,
          examples: l.examples,
          color: l.color,
          // `?? null`, not a bare `actorId`: this project's tsconfig sets
          // exactOptionalPropertyTypes, and the nullable `updated_by` column
          // accepts `string | null` but not `undefined` explicitly.
          updatedBy: actorId ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [orgHierarchyLevels.tenantId, orgHierarchyLevels.levelKey],
          set: {
            sortOrder: l.order,
            label: l.label,
            description: l.description,
            examples: l.examples,
            color: l.color,
            // `?? null`, not a bare `actorId`: this project's tsconfig sets
          // exactOptionalPropertyTypes, and the nullable `updated_by` column
          // accepts `string | null` but not `undefined` explicitly.
          updatedBy: actorId ?? null,
            updatedAt: new Date(),
          },
        });
    }
    const rows = await tx.select().from(orgHierarchyLevels).where(eq(orgHierarchyLevels.tenantId, tenantId));
    return rows.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  });
}
