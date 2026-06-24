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
