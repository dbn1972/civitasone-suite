/**
 * A-N2 (UAT post-b14, GIGW 3.0 identity / last updated).
 *
 * "Last updated" is derived, never invented: an owner-set content date
 * (NEXT_PUBLIC_CONTENT_UPDATED_AT) wins, otherwise the build time that
 * next.config.mjs bakes in (NEXT_PUBLIC_BUILD_TIME). The owning department is
 * department config (NEXT_PUBLIC_GIGW_OWNER, see departmentConfig.ts) with a
 * labelled demonstration default.
 *
 * Callers pass the values in: Next only inlines `process.env.NEXT_PUBLIC_*`
 * where it is written literally, so the component reads them, not this file.
 */
function validDate(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return Number.isNaN(new Date(v).getTime()) ? null : v;
}

export function contentLastUpdated(contentUpdatedAt: string | null | undefined, buildTime: string | null | undefined): string | null {
  return validDate(contentUpdatedAt) ?? validDate(buildTime);
}

/** Name of the owner-supplied config value that holds the department / ministry. */
export const GIGW_OWNER_CONFIG = "NEXT_PUBLIC_GIGW_OWNER";
