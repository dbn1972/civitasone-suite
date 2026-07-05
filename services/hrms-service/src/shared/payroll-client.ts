/**
 * Payroll-service internal HTTP client.
 *
 * Used by the hrms-service F&F route to fetch tax breakdown from the
 * payroll-service's internal endpoint. Uses circuit breaker (SC-6) for
 * resilience — if payroll-service is down, callers degrade gracefully.
 */
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

const PAYROLL_URL = process.env.PAYROLL_SERVICE_URL ?? "http://127.0.0.1:3013";
const SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "";
const TIMEOUT_MS = 5_000;

/** Circuit breaker: 5 consecutive failures → open for 30s. */
const breaker = new CircuitBreaker({
  name: "payroll-fnf-tax",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

export { CircuitBreakerOpenError };

export interface FnfTaxBreakdownParams {
  employeeId: string;
  separationDate: string;
  separationType: string;
  employeeCategory: string;
  noticeBuyoutMinor: string;
  leaveEncashmentGrossMinor: string;
  gratuityGrossMinor: string;
  retrenchmentCompMinor: string;
  vrsCompMinor: string;
  arrearsMinor: string;
  lastDrawnWagesMinor: string;
  completedYears: number;
  avgSalaryLast10MonthsMinor: string;
  leaveBalanceDays: number;
  priorLeaveEncashExemptionMinor: string;
  remainingMonthsToRetirement: number;
  taxRegime: string;
  salaryYtdMinor: string;
  tdsYtdMinor: string;
  deductions80cMinor: string;
  deductions80dMinor: string;
  otherDeductionsMinor: string;
  fyStartYear: number;
}

export interface FnfTaxBreakdownResult {
  totalGrossMinor: string;
  totalExemptMinor: string;
  totalTaxableOnSeparationMinor: string;
  annualTaxableMinor: string;
  annualTaxMinor: string;
  tdsAlreadyDeductedMinor: string;
  tdsOnSeparationMinor: string;
  netPayableMinor: string;
  gratuityExemption: { exemptMinor: string; taxableMinor: string };
  leaveEncashExemption: { exemptMinor: string; taxableMinor: string };
  retrenchmentExemption: { exemptMinor: string; taxableMinor: string } | null;
  vrsExemption: { exemptMinor: string; taxableMinor: string } | null;
}

export class PayrollUnavailableError extends Error {
  readonly code = "PAYROLL_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "PayrollUnavailableError";
  }
}

/**
 * Fetch F&F tax breakdown from payroll-service internal endpoint.
 * Throws PayrollUnavailableError on network/timeout/5xx/circuit-open.
 */
export async function fetchFnfTaxBreakdown(
  tenantId: string,
  params: FnfTaxBreakdownParams,
): Promise<FnfTaxBreakdownResult> {
  const qs = new URLSearchParams();
  qs.set("employeeId", params.employeeId);
  qs.set("separationDate", params.separationDate);
  qs.set("separationType", params.separationType);
  qs.set("employeeCategory", params.employeeCategory);
  qs.set("noticeBuyoutMinor", params.noticeBuyoutMinor);
  qs.set("leaveEncashmentGrossMinor", params.leaveEncashmentGrossMinor);
  qs.set("gratuityGrossMinor", params.gratuityGrossMinor);
  qs.set("retrenchmentCompMinor", params.retrenchmentCompMinor);
  qs.set("vrsCompMinor", params.vrsCompMinor);
  qs.set("arrearsMinor", params.arrearsMinor);
  qs.set("lastDrawnWagesMinor", params.lastDrawnWagesMinor);
  qs.set("completedYears", String(params.completedYears));
  qs.set("avgSalaryLast10MonthsMinor", params.avgSalaryLast10MonthsMinor);
  qs.set("leaveBalanceDays", String(params.leaveBalanceDays));
  qs.set("priorLeaveEncashExemptionMinor", params.priorLeaveEncashExemptionMinor);
  qs.set("remainingMonthsToRetirement", String(params.remainingMonthsToRetirement));
  qs.set("taxRegime", params.taxRegime);
  qs.set("salaryYtdMinor", params.salaryYtdMinor);
  qs.set("tdsYtdMinor", params.tdsYtdMinor);
  qs.set("deductions80cMinor", params.deductions80cMinor);
  qs.set("deductions80dMinor", params.deductions80dMinor);
  qs.set("otherDeductionsMinor", params.otherDeductionsMinor);
  qs.set("fyStartYear", String(params.fyStartYear));

  const url = `${PAYROLL_URL}/v1/payroll/internal/fnf-tax-breakdown?${qs.toString()}`;

  let res: Response;
  try {
    res = await breaker.call(() =>
      fetch(url, {
        headers: {
          "x-internal": "1",
          "x-service-secret": SERVICE_SECRET,
          "x-tenant-id": tenantId,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    );
  } catch (err) {
    if (err instanceof CircuitBreakerOpenError) {
      throw new PayrollUnavailableError("payroll-service circuit breaker open");
    }
    throw new PayrollUnavailableError(`payroll-service unreachable: ${(err as Error).message}`);
  }

  if (!res.ok) {
    throw new PayrollUnavailableError(`payroll-service returned ${res.status}`);
  }

  const body = (await res.json()) as { data: FnfTaxBreakdownResult };
  return body.data;
}
