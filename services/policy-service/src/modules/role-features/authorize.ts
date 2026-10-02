import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
import { readScoped } from "../../shared/db.js";
import { and, eq, inArray } from "drizzle-orm";
import { roleFeatureGrants } from "./schema.js";
import { isPlatformCaller, isPlatformFeature, mayManageFeature } from "./authority.js";

/** Features currently granted to any of the caller's own roles (tenant-scoped). */
export async function loadCallerFeatures(ctx: RequestContext): Promise<Set<string>> {
  if (ctx.roles.length === 0) return new Set();
  const rows = await readScoped(ctx.tenantId, (tx) =>
    tx.select({ featureKey: roleFeatureGrants.featureKey }).from(roleFeatureGrants).where(
      and(eq(roleFeatureGrants.tenantId, ctx.tenantId), inArray(roleFeatureGrants.roleName, [...ctx.roles]), eq(roleFeatureGrants.granted, true)),
    ),
  );
  return new Set(rows.map((r) => r.featureKey));
}

/** featureKey of an existing grant, or null when the id is unknown in this tenant. */
export async function findGrantFeatureKey(ctx: RequestContext, grantId: string): Promise<string | null> {
  const rows = await readScoped(ctx.tenantId, (tx) =>
    tx.select({ featureKey: roleFeatureGrants.featureKey }).from(roleFeatureGrants).where(
      and(eq(roleFeatureGrants.tenantId, ctx.tenantId), eq(roleFeatureGrants.id, grantId)),
    ),
  );
  return rows[0]?.featureKey ?? null;
}

/** Throws 403 FEATURE_AUTHORITY unless the caller may grant/revoke `featureKey`. */
export async function assertMayManageFeature(ctx: RequestContext, featureKey: string): Promise<void> {
  // Cheap exits first: no DB read for platform callers or ordinary features.
  if (isPlatformCaller(ctx.roles) || !isPlatformFeature(featureKey)) return;
  const held = await loadCallerFeatures(ctx);
  if (!mayManageFeature(ctx.roles, featureKey, held)) {
    throw new HttpError(403, "FEATURE_AUTHORITY", `you may not grant or revoke '${featureKey}': it is an administration/platform feature you do not hold`);
  }
}
