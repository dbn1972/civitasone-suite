/**
 * GAP-PAYROLL-TAX-DECLARATION-02: pure rules for investment-proof uploads
 * (no I/O -- unit-tested directly).
 */

export const PROOF_LINES = ["rent", "sec80c", "sec80d", "sec80g", "home_loan_interest", "other"] as const;
export type ProofLine = (typeof PROOF_LINES)[number];

export const PROOF_STATUSES = ["pending", "accepted", "rejected", "removed"] as const;
export type ProofStatus = (typeof PROOF_STATUSES)[number];

/** Allowed content type -> the extension the server puts on the key. */
export const PROOF_CONTENT_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
} as const;
export type ProofContentType = keyof typeof PROOF_CONTENT_TYPES;

export const PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const MAX_PROOFS_PER_LINE = 10;
/** Seconds an upload / view link stays valid (<= 300 by policy). */
export const PROOF_UPLOAD_TTL_SECONDS = 300;
export const PROOF_VIEW_TTL_SECONDS = 300;

export const DEFAULT_RETENTION_YEARS = 8;
export const MIN_RETENTION_YEARS = 1;
export const MAX_RETENTION_YEARS = 10;

/** The employee: own proofs only. */
export const EMPLOYEE_ROLE = "employee";
/** May verify (accept / reject) and view proof files. */
export const DECIDER_ROLES = ["payroll_officer", "payroll_admin"] as const;
/**
 * May LIST and VIEW (never decide): the deciders plus the read-only `auditor`
 * realm role (the only auditor role in the realm catalogue; there is no
 * `internal_auditor`). Deliberately NOT hr_*, manager, finance_* or super_admin.
 */
export const VIEWER_ROLES = [...DECIDER_ROLES, "auditor"] as const;
/** May place / release a legal hold. */
export const HOLD_ROLES = ["payroll_admin"] as const;
/** May change the tenant retention period. */
export const RETENTION_ROLES = ["payroll_admin", "tenant_admin", "super_admin"] as const;

export const FY_RE = /^(\d{4})-(\d{2})$/;

/** Start year of "2025-26" -> 2025; null if malformed (suffix must be startYear+1 mod 100). */
export function fyStartYear(fy: string): number | null {
  const m = FY_RE.exec(fy);
  if (!m) return null;
  const start = parseInt(m[1]!, 10);
  return parseInt(m[2]!, 10) === (start + 1) % 100 ? start : null;
}

export function proofKeyPrefix(tenantId: string, fy: string, employeeId: string): string {
  return `payroll/${tenantId}/tax-proofs/${fy}/${employeeId}/`;
}

/** Server-generated key. `uuid` is supplied by the caller (randomUUID()). */
export function buildProofKey(tenantId: string, fy: string, employeeId: string, uuid: string, contentType: ProofContentType): string {
  return `${proofKeyPrefix(tenantId, fy, employeeId)}${uuid}.${PROOF_CONTENT_TYPES[contentType]}`;
}

const KEY_TAIL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$/;

/**
 * Whether `key` is exactly a key this server would issue for THIS tenant, FY
 * and employee. Returns the content type implied by the extension, or null for
 * a foreign / forged / malformed key (path traversal, other tenant, other
 * employee, other FY, wrong shape).
 */
export function contentTypeOfOwnKey(key: string, tenantId: string, fy: string, employeeId: string): ProofContentType | null {
  const prefix = proofKeyPrefix(tenantId, fy, employeeId);
  if (!key.startsWith(prefix)) return null;
  const tail = key.slice(prefix.length);
  const m = KEY_TAIL_RE.exec(tail);
  if (!m) return null;
  const entry = (Object.entries(PROOF_CONTENT_TYPES) as Array<[ProofContentType, string]>).find(([, ext]) => ext === m[1]);
  return entry ? entry[0] : null;
}

/** Clean display filename: strip any path, control chars; bounded. Never used in the key. */
export function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]+/g, "").trim();
  return (base.length > 0 ? base : "proof").slice(0, 200);
}

/**
 * Last day (UTC) a proof is retained: 31 March at the end of its financial
 * year plus `years`. FY "2025-26" ends 31 Mar 2026, so with 8 years it is
 * retained through 31 Mar 2034 and is purge-due from 1 Apr 2034.
 */
export function retentionEndsOn(fy: string, years: number): Date | null {
  const start = fyStartYear(fy);
  if (start === null) return null;
  return new Date(Date.UTC(start + 1 + years, 2, 31, 23, 59, 59, 999));
}

export function isPurgeDue(input: { fy: string; years: number; legalHold: boolean; status: string }, now: Date): boolean {
  if (input.legalHold) return false;
  if (input.status === "removed") return true; // withdrawn by the employee: no retention basis
  const end = retentionEndsOn(input.fy, input.years);
  return end !== null && now.getTime() > end.getTime();
}

/** The declaration column a proof line is compared against (null: no declared figure exists). */
export const DECLARED_COLUMN: Record<ProofLine, "section_80c" | "section_80d" | "rent_paid_minor" | "other_deductions" | null> = {
  rent: "rent_paid_minor",
  sec80c: "section_80c",
  sec80d: "section_80d",
  sec80g: null,
  home_loan_interest: null,
  other: "other_deductions",
};
