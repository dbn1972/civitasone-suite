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
