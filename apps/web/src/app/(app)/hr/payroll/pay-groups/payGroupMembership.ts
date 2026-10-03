/**
 * Pure helpers for pay-group membership (GAP-PAYROLL-PAY-GROUPS-03): payload
 * builders, CSV parsing, default dates, paging and the run-scope picker. Kept
 * out of the page/dialog files so the rules are unit-testable and the pages
 * carry no count/emptiness logic of their own.
 */

export const BILL_TYPES = ["gazetted", "non_gazetted", "contract", "casual", "other"] as const;
export type BillType = (typeof BILL_TYPES)[number];

export function isBillType(v: unknown): v is BillType {
  return typeof v === "string" && (BILL_TYPES as readonly string[]).includes(v);
}

/** Backend reason minimum (payroll-service), mirrored so the dialog gates Confirm. */
export const MIN_REASON_LENGTH = 10;
export const MAX_REASON_LENGTH = 500;
/** Backend cap on rows per bulk assign. */
export const BULK_MAX_ROWS = 500;
/** Backend cap on pay groups per run request. */
export const RUN_MAX_GROUPS = 20;
export const MEMBERS_PAGE_SIZE = 50;

export type MemberStatus = "current" | "scheduled" | "ended";

export function isMemberStatus(v: unknown): v is MemberStatus {
  return v === "current" || v === "scheduled" || v === "ended";
}

export type MemberRow = {
  assignmentId: string;
  employeeId: string;
  employeeNo: string;
  fullName: string;
  departmentName: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: MemberStatus;
  reason: string | null;
} & Record<string, unknown>;

export type UnassignedRow = {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  departmentName: string | null;
} & Record<string, unknown>;

export type GroupOption = { id: string; name: string };
export type DdoOption = { ddoCode: string; name: string };

/** True for an empty (or missing) list -- the page-level check lives here, behind the error gate. */
export function hasNoRows(rows: readonly unknown[] | null | undefined): boolean {
  return !rows || rows.length === 0;
}

/* ------------------------------------------------------------------ dates */

/** First day of the month after `today` ("YYYY-MM-DD"), the default effective date. */
export function firstOfNextMonth(today: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(today);
  if (!m) return "";
  let year = Number(m[1]);
  let month = Number(m[2]) + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function isIsoDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function isMonthValue(v: string | undefined | null): v is string {
  return !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** Month from a query param, falling back to `fallback` (the current month) when absent/garbled. */
export function resolveMonth(param: string | undefined, fallback: string): string {
  return isMonthValue(param) ? param : fallback;
}

/* ------------------------------------------------------------ validation */

export type MembershipFormProblem = "dateInvalid" | "reasonShort" | "targetRequired" | "employeeRequired";

export function membershipFormProblem(input: { date: string; reason: string; needTarget?: boolean; target?: string }): MembershipFormProblem | null {
  if (!isIsoDate(input.date)) return "dateInvalid";
  if (input.needTarget && !input.target) return "targetRequired";
  if (input.reason.trim().length < MIN_REASON_LENGTH) return "reasonShort";
  return null;
}

/* ------------------------------------------------------- payload builders */

export type AssignBodyInput =
  | { employeeId: string; employeeNo?: undefined; effectiveFrom: string; reason: string }
  | { employeeNo: string; employeeId?: undefined; effectiveFrom: string; reason: string };

/** Assign (or move, when the employee is already in another group): exactly one of employeeId / employeeNo. */
export function buildAssignBody(input: AssignBodyInput): Record<string, string> {
  const body: Record<string, string> = { effectiveFrom: input.effectiveFrom, reason: input.reason.trim() };
  if (input.employeeId) body.employeeId = input.employeeId;
  else if (input.employeeNo) body.employeeNo = input.employeeNo.trim();
  return body;
}

export function buildEndBody(input: { endsOn: string; reason: string }): { endsOn: string; reason: string } {
  return { endsOn: input.endsOn, reason: input.reason.trim() };
}

export function buildBulkBody(input: { effectiveFrom: string; reason: string; employeeNos: readonly string[] }): {
  effectiveFrom: string;
  reason: string;
  rows: { employeeNo: string }[];
} {
  return {
    effectiveFrom: input.effectiveFrom,
    reason: input.reason.trim(),
    rows: input.employeeNos.map((employeeNo) => ({ employeeNo })),
  };
}

/* -------------------------------------------------------------- CSV input */

export type ParsedEmployeeCsv = {
  employeeNos: string[];
  /** Repeated numbers dropped from the list. */
  duplicateCount: number;
  exceedsLimit: boolean;
};

const HEADER_NAMES = new Set(["employeeno", "employeenumber", "employeecode", "empno"]);

function unquote(cell: string): string {
  const c = cell.trim();
  return c.length >= 2 && c.startsWith('"') && c.endsWith('"') ? c.slice(1, -1).trim() : c;
}

function normalizeHeader(cell: string): string {
  return unquote(cell).toLowerCase().replace(/[\s_-]/g, "");
}

/**
 * Employee numbers from pasted / uploaded text: one number per line, or a CSV
 * whose header row names an `employeeNo` column (any other columns ignored).
 * Blank lines are skipped, repeats dropped (counted).
 */
export function parseEmployeeCsv(text: string): ParsedEmployeeCsv {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  let column = 0;
  let start = 0;
  if (lines.length > 0) {
    const headerCells = lines[0].split(",").map(normalizeHeader);
    const idx = headerCells.findIndex((c) => HEADER_NAMES.has(c));
    if (idx >= 0) {
      column = idx;
      start = 1;
    }
  }
  const seen = new Set<string>();
  const employeeNos: string[] = [];
  let duplicateCount = 0;
  for (const line of lines.slice(start)) {
    const value = unquote(line.split(",")[column] ?? "");
    if (value === "") continue;
    if (seen.has(value)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(value);
    employeeNos.push(value);
  }
  return { employeeNos, duplicateCount, exceedsLimit: employeeNos.length > BULK_MAX_ROWS };
}

/* ------------------------------------------------------------ bulk result */

export type BulkRejection = { row: number; employeeNo: string | null; code: string };
export type BulkResult = { accepted: number; rejected: BulkRejection[] };

function toRejections(v: unknown): BulkRejection[] {
  if (!Array.isArray(v)) return [];
  return v.map((r) => {
    const o = (r ?? {}) as { row?: unknown; employeeNo?: unknown; code?: unknown };
    return {
      row: typeof o.row === "number" ? o.row : 0,
      employeeNo: typeof o.employeeNo === "string" ? o.employeeNo : null,
      code: typeof o.code === "string" ? o.code : "",
    };
  });
}

/** From a 202 body `{ data: { accepted, rejected } }`. */
export function parseBulkResult(body: unknown): BulkResult {
  const data = ((body ?? {}) as { data?: { accepted?: unknown; rejected?: unknown } }).data ?? {};
  return { accepted: typeof data.accepted === "number" ? data.accepted : 0, rejected: toRejections(data.rejected) };
}

/** From a 422 BULK_NOTHING_TO_ASSIGN error's `details`. */
export function parseBulkRejection(details: unknown): BulkResult {
  const d = (details ?? {}) as { rejected?: unknown };
  return { accepted: 0, rejected: toRejections(d.rejected) };
}

const REJECT_CODE_KEYS: Record<string, string> = {
  EMPLOYEE_NOT_FOUND: "EMPLOYEE_NOT_FOUND",
  ALREADY_MEMBER: "ALREADY_MEMBER",
  MEMBERSHIP_OVERLAP: "MEMBERSHIP_OVERLAP",
  DUPLICATE_ROW: "DUPLICATE_ROW",
  EMPLOYEE_NOT_ACTIVE: "EMPLOYEE_NOT_ACTIVE",
  EMPLOYEE_NO_REQUIRED: "EMPLOYEE_NO_REQUIRED",
};

/** i18n key (under payGroupMembers.rejectCode) for a row's rejection code; unknown codes use a generic line. */
export function rejectCodeKey(code: string): string {
  return REJECT_CODE_KEYS[code] ?? "OTHER";
}

/* ----------------------------------------------------------------- paging */

export function parseOffset(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export type PageWindow = { from: number; to: number; prevOffset: number | null; nextOffset: number | null };

export function pageWindow(total: number, limit: number, offset: number): PageWindow {
  const from = total > 0 ? offset + 1 : 0;
  const to = Math.min(offset + limit, total);
  return {
    from,
    to,
    prevOffset: offset > 0 ? Math.max(0, offset - limit) : null,
    nextOffset: offset + limit < total ? offset + limit : null,
  };
}

/* -------------------------------------------------------------- detail tab */

export type DetailTab = "details" | "members";
export function parseTab(v: string | undefined): DetailTab {
  return v === "members" ? "members" : "details";
}

/* -------------------------------------------------------- run-scope picker */

export type RunScope =
  | { kind: "tenant" }
  | { kind: "groups"; ids: readonly string[] }
  | { kind: "ddo"; ddoCode: string };

export type RunScopeProblem = "groupsRequired" | "groupsTooMany" | "ddoRequired";

export function runScopeProblem(scope: RunScope): RunScopeProblem | null {
  if (scope.kind === "groups") {
    if (scope.ids.length < 1) return "groupsRequired";
    if (scope.ids.length > RUN_MAX_GROUPS) return "groupsTooMany";
  }
  if (scope.kind === "ddo" && !scope.ddoCode) return "ddoRequired";
  return null;
}

/** Extra POST /v1/payroll/runs fields for the scope. Whole-tenant adds none, so the legacy payload is unchanged. */
export function runScopeFields(scope: RunScope): Record<string, unknown> {
  if (scope.kind === "groups") {
    return scope.ids.length === 1 ? { payGroupId: scope.ids[0] } : { payGroupIds: [...scope.ids] };
  }
  if (scope.kind === "ddo") return { ddoCode: scope.ddoCode, allPayGroupsOfDdo: true };
  return {};
}

export type RunCreateResult = { id: string | null; runIds: string[]; skippedEmptyGroups: string[] };

/** Run ids from a create response: scoped `{ data: { runIds, skippedEmptyGroups } }` or legacy `{ id }`. */
export function parseRunCreateResult(body: unknown): RunCreateResult {
  const b = (body ?? {}) as { id?: unknown; data?: { runIds?: unknown; skippedEmptyGroups?: unknown } };
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    id: typeof b.id === "string" ? b.id : null,
    runIds: strings(b.data?.runIds),
    skippedEmptyGroups: strings(b.data?.skippedEmptyGroups),
  };
}
