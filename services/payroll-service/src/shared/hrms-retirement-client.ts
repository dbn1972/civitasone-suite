const HRMS_URL = process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012";

export type HrmsGpfAccountParams = { monthlySubscriptionMinor: bigint; status: string };
export type HrmsNpsAccountParams = { empContribPct: number; erContribPct: number; status: string };
export type HrmsRetirementAccounts = {
  gpf: Map<string, HrmsGpfAccountParams>;
  nps: Map<string, HrmsNpsAccountParams>;
  /** hrms cut the list at its cap: an employee missing from the map may still have an account. */
  gpfTruncated: boolean;
  npsTruncated: boolean;
};

/**
 * GAP-PAYROLL-STATUTORY-GPF-02 / NPS-02: the contribution parameters HR
 * configured on each employee's hrms-service GPF / NPS account, keyed by
 * employeeId. Display/reconciliation only, so it fails OPEN to `null` (the
 * report then says "HRMS unavailable" instead of guessing a verdict) and
 * never gates the statutory report.
 */
export async function fetchRetirementAccounts(tenantId: string): Promise<HrmsRetirementAccounts | null> {
  const url = `${HRMS_URL}/v1/hrms/internal/retirement-accounts`;
  try {
    const res = await fetch(url, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = await res.json() as {
      gpf?: Array<{ employeeId: string; monthlySubscriptionMinor: string; status: string }>;
      nps?: Array<{ employeeId: string; empContribPct: number; erContribPct: number; status: string }>;
      gpfTruncated?: boolean;
      npsTruncated?: boolean;
    };
    return {
      gpf: new Map((body.gpf ?? []).map((r) => [r.employeeId, { monthlySubscriptionMinor: BigInt(r.monthlySubscriptionMinor), status: r.status }])),
      nps: new Map((body.nps ?? []).map((r) => [r.employeeId, { empContribPct: r.empContribPct, erContribPct: r.erContribPct, status: r.status }])),
      gpfTruncated: body.gpfTruncated === true,
      npsTruncated: body.npsTruncated === true,
    };
  } catch {
    return null;
  }
}
