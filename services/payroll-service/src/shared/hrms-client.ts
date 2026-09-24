const HRMS_URL = process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012";

/**
 * M4: raised when the HRMS payroll-input fetch fails (network/timeout/non-2xx).
 * Callers that build statutory/identity output (24Q, 12BA, Form 16, NPS-SCF)
 * must FAIL the export on this rather than silently emitting blank identities,
 * because a blank PAN/PRAN on a *reachable* employee (genuinely no PAN) is a
 * legitimate PANNOTAVBL flag, whereas a blank caused by an unreachable HRMS is
 * a filed-but-invalid return. Distinguishing the two requires this signal.
 */
export class HrmsUnavailableError extends Error {
  readonly code = "HRMS_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "HrmsUnavailableError";
  }
}

export type PayrollInputEmployee = {
  id: string;
  employeeNo: string;
  fullName: string;
  basicMinor: string;
  /**
   * BUG-1 fix: YYYY-MM-DD. Used to pro-rate a mid-month joiner's first slip —
   * days before joining within the run month are unpaid. No symmetric
   * dateOfLeaving here: a separated employee is dropped from the HRMS feed
   * entirely (see routes.ts comment), so leaving-date proration for the
   * regular run has no live case; separation pay is the FnF flow's job.
   */
  dateOfJoining: string;
  payStructureId: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  pan: string | null;
  uan: string | null;
  pran?: string | null;
  cityClass: "X" | "Y" | "Z";
  taxRegime: "old" | "new";
  departmentId: string;
  pensionScheme: "GPF" | "NPS" | "EPF";
};

export type HrmsPayrollInput = {
  month: string;
  employees: PayrollInputEmployee[];
  lopDays: Record<string, number>;
  /**
   * MEDIUM fix: approved overtime hours by employeeId for the month (see
   * hrms-service's attendanceRepo.findApprovedOvertimeInMonth) -- HRMS has a
   * full overtime request/approve workflow that this service never
   * referenced anywhere, so approved overtime was tracked and never paid.
   * NOTE: surfacing only -- nothing in this service's payroll run/slip
   * computation reads this field yet to actually pay for it. Wiring an
   * overtime rate/component into the slip domain is a larger, separate
   * change, deliberately deferred rather than done partially here.
   */
  overtimeHours: Record<string, number>;
};

export async function fetchPayrollInput(tenantId: string, month: string): Promise<HrmsPayrollInput> {
  const url = `${HRMS_URL}/v1/hrms/internal/payroll-input?month=${encodeURIComponent(month)}`;
  const serviceSecret = process.env.INTERNAL_SERVICE_SECRET ?? "";
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "x-internal": "1",
        "x-service-secret": serviceSecret,
        "x-tenant-id": tenantId,
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    // Network failure / timeout / DNS — HRMS is unreachable, not "no data".
    throw new HrmsUnavailableError(`hrms payroll-input unreachable: ${(err as Error).message}`);
  }
  if (!res.ok) throw new HrmsUnavailableError(`hrms payroll-input failed: ${res.status}`);
  return res.json() as Promise<HrmsPayrollInput>;
}

export async function fetchPendingPayrollRuns(tenantId: string): Promise<number> {
  const PAYROLL_URL = process.env.PAYROLL_SERVICE_URL ?? "http://127.0.0.1:3013";
  const res = await fetch(`${PAYROLL_URL}/v1/payroll/runs?limit=50`, {
    headers: { "x-internal": "1", "x-tenant-id": tenantId },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return 0;
  const rows = await res.json() as Array<{ status: string }>;
  return rows.filter((r) => r.status === "processing" || r.status === "draft").length;
}

export async function fetchEmployeeSummaries(tenantId: string): Promise<Map<string, { fullName: string; departmentName: string }>> {
  const url = `${HRMS_URL}/v1/hrms/internal/employee-summaries`;
  try {
    const res = await fetch(url, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new Map();
    const rows = await res.json() as Array<{ id: string; fullName: string; departmentName: string }>;
    return new Map(rows.map((r) => [r.id, { fullName: r.fullName, departmentName: r.departmentName }]));
  } catch {
    return new Map();
  }
}

/**
 * round2 fix: payroll and HRMS are separate databases (no DB-level FK is
 * possible), and arrears/bonus/reimbursements accepted any well-formed UUID
 * as employeeId with no check it corresponds to a real employee in the
 * caller's tenant.
 *
 * round2 review fix: the first version of this function reused
 * fetchEmployeeSummaries' /v1/hrms/internal/employee-summaries endpoint,
 * which is `.limit(2000)` with no `.orderBy(...)` — for a tenant over that
 * size it returns an arbitrary, unordered subset, so a real employeeId
 * landing outside that subset would be wrongly reported as nonexistent and
 * a legitimate request rejected. employee-summaries' two existing callers
 * both treat that incompleteness as tolerable (display enrichment,
 * best-effort); a hard reject cannot. Calls a dedicated internal point
 * lookup instead (hrms-service's employeeRepo.findById under the hood, via
 * GET .../employees/:id/exists) — correct at any tenant size, and returns
 * only a boolean rather than a full employee record, so the internal
 * boundary doesn't leak more PII than this caller actually needs.
 *
 * Fails CLOSED (throws HrmsUnavailableError) on an unreachable/erroring
 * HRMS, unlike fetchEmployeeSummaries above which fails OPEN to an empty Map
 * for its display-only, best-effort use case. Silently treating "HRMS
 * unreachable" as "employee doesn't exist" here would produce a
 * false-positive rejection indistinguishable from a genuinely bad
 * employeeId. Mirrors fetchPayrollInput's own fail-closed contract above.
 */
export async function verifyEmployeeExists(tenantId: string, employeeId: string): Promise<boolean> {
  const url = `${HRMS_URL}/v1/hrms/internal/employees/${encodeURIComponent(employeeId)}/exists`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new HrmsUnavailableError(`hrms employee existence check unreachable: ${(err as Error).message}`);
  }
  if (!res.ok) throw new HrmsUnavailableError(`hrms employee existence check failed: ${res.status}`);
  const body = await res.json() as { exists: boolean };
  return body.exists;
}

/**
 * BUG-2 fix: DIC engagement-exemption check for a single employee, used by
 * integration/consumer.ts to gate payrollLopLedger writes at ingest time
 * (leaveApproved / attendanceMarked handlers), BEFORE lopRepo.upsertLopDays.
 * Without this, an exempt employee's (consultant/third-party/apprentice)
 * approved leave or marked attendance still lands in the ledger, and the
 * payroll run PREFERS that ledger over this module's own fetchPayrollInput
 * lopDays whenever any ledger row exists for the month (see payroll/
 * consumer.ts's "M2 LOP double-count" comment) — silently overriding the
 * correct exclusion.
 *
 * Mirrors hrms-service's own attendanceLopApplies (engagement-policy.ts)
 * exactly via a dedicated internal lookup (rather than re-deriving the
 * policy locally from fields this service doesn't have at ingest time), so
 * the ledger-write gate and the payroll-input live-pull route can never
 * disagree on who is exempt.
 *
 * Fails CLOSED (throws HrmsUnavailableError) on an unreachable/erroring
 * HRMS, mirroring fetchPayrollInput/verifyEmployeeExists above — LOP
 * correctness is financial, so this must never silently guess when HRMS
 * cannot be reached; the caller lets the queue's own redelivery retry later.
 *
 * A 404 (employee not found in HRMS) is NOT unreachability — it returns
 * `true` (LOP applies), the same permissive default DEFAULT_POLICY resolves
 * to for an employee engagement-typing can't otherwise classify, so a
 * lookup race never silently exempts someone it shouldn't.
 */
export async function fetchAttendanceLopApplies(tenantId: string, employeeId: string): Promise<boolean> {
  const url = `${HRMS_URL}/v1/hrms/internal/employees/${encodeURIComponent(employeeId)}/attendance-lop-applies`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "x-internal": "1",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": tenantId,
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new HrmsUnavailableError(`hrms attendance-lop-applies check unreachable: ${(err as Error).message}`);
  }
  if (res.status === 404) return true;
  if (!res.ok) throw new HrmsUnavailableError(`hrms attendance-lop-applies check failed: ${res.status}`);
  const body = await res.json() as { attendanceLopApplies: boolean };
  return body.attendanceLopApplies;
}

export type PayrollSlipTemplate = {
  templateHtml: string;
  isDefault: boolean;
  name?: string;
  footerText?: string | null;
};

/**
 * payroll.payroll_slip_templates physically lives in hrms-service's
 * database (civitas_hrms), not payroll-service's own (civitas_payroll) —
 * there is no dblink/postgres_fdw between the two, so payroll-service can
 * never query that table directly (see payslip-pdf/routes.ts, which used to
 * try). Fetches the tenant's active default template over hrms-service's
 * internal API instead, same pattern as fetchPayrollInput/verifyEmployeeExists
 * above.
 *
 * Returns `null` (not an error) when hrms-service is reachable but the
 * tenant genuinely has no default template configured — that is a
 * legitimate "not configured" state the caller should treat as "use the
 * built-in default", not a degraded-service condition. Only network/
 * timeout/non-2xx-non-404 failures throw HrmsUnavailableError, mirroring
 * the fail-closed-on-unreachability contract of the other functions here
 * (the caller decides whether "unreachable" also falls back to the default
 * template — see payslip-pdf/routes.ts).
 */
export async function fetchDefaultSlipTemplate(tenantId: string): Promise<PayrollSlipTemplate | null> {
  const url = `${HRMS_URL}/v1/hrms/internal/payroll/slip-templates/default`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "x-internal": "1",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": tenantId,
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new HrmsUnavailableError(`hrms slip-template fetch unreachable: ${(err as Error).message}`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new HrmsUnavailableError(`hrms slip-template fetch failed: ${res.status}`);
  return res.json() as Promise<PayrollSlipTemplate>;
}
