/**
 * S8-G4 -- private grade bands (C2, T3, M2 ...) for tenants that are not on the 7th CPC pay matrix.
 *
 * Client-safe helpers only (no fetching). The tenant's pay scale comes from the hrms policy setting
 * `pay_scale` ('cpc7' default = government pay matrix, levels 1-18; 'private_bands' = grade bands).
 * Anything this file cannot read falls back to 'cpc7', so a government tenant never sees a band screen
 * by accident.
 */

export type PayScaleKind = "cpc7" | "private_bands";

export interface GradeBand {
  id: string;
  code: string;
  name: string;
  /** Higher == more senior. */
  rank: number;
  track: string | null;
  /** Indicative annual CTC range in paise, as digit strings (bigint is not JSON). */
  ctcMinMinor: string | null;
  ctcMaxMinor: string | null;
  noticeDays: number | null;
  isActive: boolean;
  version: number;
  /** Designations that point at this band (admin list only). */
  designationCount?: number;
}

/**
 * Mirrors services/hrms-service/src/modules/grade-bands/routes.ts (ADMIN_ROLES / GRADE_BAND_READ_ROLES) and
 * policy-settings/routes.ts (WRITE_ROLES) 1:1. The server re-checks every call; these only decide what is shown.
 */
export const GRADE_BAND_ADMIN_ROLES = ["hr_admin", "super_admin", "admin", "tenant_admin", "platform_admin"];
export const GRADE_BAND_READ_ROLES = [...GRADE_BAND_ADMIN_ROLES, "hr_officer", "manager", "officer", "payroll_admin", "payroll_officer"];
export const PAY_SCALE_WRITE_ROLES = ["hr_admin", "super_admin", "tenant_admin", "platform_admin"];

export const MIN_BAND_RANK = 1;
export const MAX_BAND_RANK = 9999;
export const MAX_BAND_CODE_LENGTH = 16;
/** Same rule as the backend (grade-bands/validators.ts): letters, digits, '.', '_', '-'; starts with a letter or digit. */
export const BAND_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The effective pay scale out of GET /v1/hrms/policy-settings (`{ data: [{ key, value }] }`). Anything unexpected is 'cpc7'. */
export function payScaleFromPolicies(payload: unknown): PayScaleKind {
  const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return "cpc7";
  const row = rows.find((r): r is { key: string; value?: { kind?: unknown } } => !!r && typeof r === "object" && (r as { key?: unknown }).key === "pay_scale");
  return row?.value?.kind === "private_bands" ? "private_bands" : "cpc7";
}

/** Defensive parse of GET /v1/hrms/admin/grade-bands. Rows without an id/code/rank are dropped. */
export function bandsFromResponse(payload: unknown): GradeBand[] {
  const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: GradeBand[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    if (!r || typeof r.id !== "string" || typeof r.code !== "string" || typeof r.rank !== "number") continue;
    out.push({
      id: r.id, code: r.code, name: typeof r.name === "string" ? r.name : r.code, rank: r.rank,
      track: typeof r.track === "string" && r.track ? r.track : null,
      ctcMinMinor: typeof r.ctcMinMinor === "string" ? r.ctcMinMinor : null,
      ctcMaxMinor: typeof r.ctcMaxMinor === "string" ? r.ctcMaxMinor : null,
      noticeDays: typeof r.noticeDays === "number" ? r.noticeDays : null,
      isActive: r.isActive !== false,
      version: typeof r.version === "number" ? r.version : 1,
      ...(typeof r.designationCount === "number" ? { designationCount: r.designationCount } : {}),
    });
  }
  return out.sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code));
}

/** "C2 — Consultant 2"; the code alone when the name adds nothing. */
export function bandLabel(b: Pick<GradeBand, "code" | "name">): string {
  return b.name && b.name !== b.code ? `${b.code} — ${b.name}` : b.code;
}

/** Paise (digit string) -> whole rupees with Indian digit grouping, exact for any size. null for blank. */
export function formatMinorAsRupees(minor: string | null | undefined): string | null {
  if (minor == null || !/^\d+$/.test(minor)) return null;
  const rupees = BigInt(minor) / 100n;
  const paise = Number(BigInt(minor) % 100n);
  const grouped = rupees.toString().replace(/\B(?=(\d{2})*\d{3}(?!\d))/g, ",");
  return paise === 0 ? grouped : `${grouped}.${String(paise).padStart(2, "0")}`;
}

/** Rupees typed in a form ("12,00,000" or "1200000.50") -> paise digit string, or null when blank, or "invalid". */
export function rupeesToMinor(raw: string): string | null | "invalid" {
  const t = raw.replace(/[,\s]/g, "");
  if (t === "") return null;
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return "invalid";
  return (BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0")).toString();
}
