/**
 * Workflow delegations: client-safe shapes, parsers and validation.
 *
 * Mirrors services/workflow-service/src/modules/delegations (routes.ts, schema.ts):
 *   POST   /v1/workflow/delegations                { delegateId, roles[1..20], fromDate, toDate, reason? }  -> 202 { id, status, correlationId }
 *   GET    /v1/workflow/delegations                -> { data: DelegationView[], total }   (whole tenant, newest first)
 *   DELETE /v1/workflow/delegations/:id            -> 202 { id, status, correlationId }
 *   GET    /v1/workflow/delegations/legacy-report  -> { data: LegacyRow[], total }        (admin roles only)
 * Errors: { code, message, correlationId, retryable } with DELEGATION_ROLE_NOT_HELD (403),
 * DELEGATION_TOO_LONG / DELEGATION_BAD_RANGE (400). The server message is never shown.
 */
import { isRealCalendarDate } from "@/lib/calendarDate";

/** Longest a delegation may run, in days from start to end. Mirrors MAX_DELEGATION_DAYS in the service. */
export const MAX_DELEGATION_DAYS = 90;
export const MAX_DELEGATION_ROLES = 20;
export const MAX_REASON_LENGTH = 256;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Delegation = {
  id: string;
  tenantId: string;
  delegatorId: string;
  delegateId: string;
  fromDate: string;
  toDate: string | null;
  reason: string | null;
  roles: string[];
  isActive: boolean;
  createdAt: string;
};

export type LegacyDelegation = {
  id: string;
  createdBy: string;
  delegateId: string;
  fromDate: string;
  toDate: string | null;
  reason: string | null;
  createdAt: string;
};

export type DelegationState = "active" | "upcoming" | "expired" | "revoked";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function rowsOf(raw: unknown): unknown[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.data)) return null;
  return raw.data;
}

/** Parse GET /v1/workflow/delegations. Returns null when the body is not the documented envelope. Malformed rows are dropped. */
export function parseDelegationList(raw: unknown): { rows: Delegation[]; total: number } | null {
  const data = rowsOf(raw);
  if (!data) return null;
  const rows: Delegation[] = [];
  for (const r of data) {
    if (!isRecord(r)) continue;
    const id = str(r.id), delegatorId = str(r.delegatorId), delegateId = str(r.delegateId), fromDate = str(r.fromDate);
    if (!id || !delegatorId || !delegateId || !fromDate) continue;
    rows.push({
      id,
      tenantId: str(r.tenantId) ?? "",
      delegatorId,
      delegateId,
      fromDate,
      toDate: str(r.toDate),
      reason: str(r.reason),
      roles: Array.isArray(r.roles) ? r.roles.filter((x): x is string => typeof x === "string") : [],
      isActive: r.isActive === true,
      createdAt: str(r.createdAt) ?? "",
    });
  }
  const total = isRecord(raw) && typeof raw.total === "number" ? raw.total : rows.length;
  return { rows, total };
}

/** Parse GET /v1/workflow/delegations/legacy-report. */
export function parseLegacyReport(raw: unknown): { rows: LegacyDelegation[]; total: number } | null {
  const data = rowsOf(raw);
  if (!data) return null;
  const rows: LegacyDelegation[] = [];
  for (const r of data) {
    if (!isRecord(r)) continue;
    const id = str(r.id), createdBy = str(r.createdBy), delegateId = str(r.delegateId), fromDate = str(r.fromDate);
    if (!id || !createdBy || !delegateId || !fromDate) continue;
    rows.push({ id, createdBy, delegateId, fromDate, toDate: str(r.toDate), reason: str(r.reason), createdAt: str(r.createdAt) ?? "" });
  }
  const total = isRecord(raw) && typeof raw.total === "number" ? raw.total : rows.length;
  return { rows, total };
}

/**
 * Lifecycle of a row on `today` (YYYY-MM-DD). Dates are inclusive; a null end date is open-ended
 * (only legacy rows). `revoked` wins over everything, matching the service's is_active flag.
 */
export function delegationState(d: Pick<Delegation, "isActive" | "fromDate" | "toDate">, today: string): DelegationState {
  if (!d.isActive) return "revoked";
  if (d.toDate !== null && d.toDate < today) return "expired";
  if (d.fromDate > today) return "upcoming";
  return "active";
}

/** Whole days from `from` to `to` (both YYYY-MM-DD), computed in UTC exactly as the service does. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `date` plus `days`, as YYYY-MM-DD (UTC calendar arithmetic, no timezone drift). */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export type DelegationFormValues = {
  roles: readonly string[];
  delegateId: string | null;
  fromDate: string;
  toDate: string;
  reason: string;
};

/** Message keys (under workflowDelegations) so the caller translates; values carry no copy. */
export type DelegationFormErrorKey =
  | "rolesRequired" | "rolesTooMany" | "roleNotHeld"
  | "delegateRequired" | "delegateSelf"
  | "fromRequired" | "fromInvalid"
  | "toRequired" | "toInvalid" | "toBeforeFrom" | "toTooLong"
  | "reasonTooLong";

export type DelegationFormErrors = Partial<Record<"roles" | "delegate" | "fromDate" | "toDate" | "reason", DelegationFormErrorKey>>;

/**
 * Client-side mirror of the service rules, for inline messages before a round trip. The service stays the authority
 * (it re-checks roles against the token and enforces the range and cap).
 */
export function validateDelegationForm(v: DelegationFormValues, ctx: { heldRoles: readonly string[]; userId: string | null }): DelegationFormErrors {
  const e: DelegationFormErrors = {};
  if (v.roles.length === 0) e.roles = "rolesRequired";
  else if (v.roles.length > MAX_DELEGATION_ROLES) e.roles = "rolesTooMany";
  else if (v.roles.some((r) => !ctx.heldRoles.includes(r))) e.roles = "roleNotHeld";

  if (!v.delegateId || !UUID_RE.test(v.delegateId)) e.delegate = "delegateRequired";
  else if (ctx.userId && v.delegateId.toLowerCase() === ctx.userId.toLowerCase()) e.delegate = "delegateSelf";

  const fromOk = isRealCalendarDate(v.fromDate);
  if (!v.fromDate) e.fromDate = "fromRequired";
  else if (!fromOk) e.fromDate = "fromInvalid";

  if (!v.toDate) e.toDate = "toRequired";
  else if (!isRealCalendarDate(v.toDate)) e.toDate = "toInvalid";
  else if (fromOk) {
    const span = daysBetween(v.fromDate, v.toDate);
    if (span < 0) e.toDate = "toBeforeFrom";
    else if (span > MAX_DELEGATION_DAYS) e.toDate = "toTooLong";
  }

  if (v.reason.length > MAX_REASON_LENGTH) e.reason = "reasonTooLong";
  return e;
}

/** Server error codes this screen explains in its own words. Anything else falls back to the shared catalogue copy. */
export const DELEGATION_ERROR_CODES = ["DELEGATION_ROLE_NOT_HELD", "DELEGATION_TOO_LONG", "DELEGATION_BAD_RANGE"] as const;
export type DelegationErrorCode = (typeof DELEGATION_ERROR_CODES)[number];

export function isDelegationErrorCode(code: unknown): code is DelegationErrorCode {
  return typeof code === "string" && (DELEGATION_ERROR_CODES as readonly string[]).includes(code);
}

/** Roles from the session, de-duplicated and sorted, ignoring anything that is not a non-empty string. */
export function heldRoleList(roles: readonly unknown[]): string[] {
  return [...new Set(roles.filter((r): r is string => typeof r === "string" && r.length > 0 && r.length <= 64))].sort();
}
