import { formatIndianDate } from "@/lib/formatters";

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

/**
 * PR #2457 review: a GIGW date in the reader language. Hindi pages use the
 * Hindi month name (Intl hi-IN, e.g. "4 नवंबर 2026"); English keeps the house
 * format ("04 Nov 2026"). Bare YYYY-MM-DD dates are calendar dates (UTC),
 * instants are shown in IST. Returns null for a value that is not a date.
 */
export function formatGigwDate(value: string, locale: string): string | null {
  if (!locale.startsWith("hi")) {
    const en = formatIndianDate(value);
    return en === "—" ? null : en;
  }
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(bare ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("hi-IN", { day: "numeric", month: "long", year: "numeric", timeZone: bare ? "UTC" : "Asia/Kolkata" }).format(d);
}
