/**
 * Pure, server-safe helpers for the payroll run exception panel.
 *
 * Deliberately NOT a "use client" module: the run detail page (a Server
 * Component) calls deriveExceptions() during its render. Exported from the
 * "use client" ExceptionPanel.tsx it was a client reference on the server, and
 * calling it threw "Attempted to call deriveExceptions() from the server",
 * crashing /hr/payroll/[id] for every run (UAT L1, Phase 1B).
 */

export type PayrollException = {
  employeeId: string;
  employeeName: string;
  issue: string;
};

/**
 * GAP-PAYROLL-DETAIL-05: the pre-disbursement issue codes payroll-service
 * attaches to each slip (hrms-service decides them; neither the PAN nor the
 * account number ever reaches the browser), mapped to translation keys of
 * the caller's `payrollDetail` namespace.
 */
export const EXCEPTION_ISSUE_KEYS: Record<string, string> = {
  MISSING_PAN: "exceptionMissingPan",
  INVALID_PAN: "exceptionInvalidPan",
  MISSING_BANK_ACCOUNT: "exceptionMissingBank",
  INVALID_IFSC: "exceptionInvalidIfsc",
};

/**
 * Derive exceptions from salary-slip data: a failed calculation, and/or the
 * issue codes on the slip. One entry per employee; several problems for the
 * same employee are listed together.
 * `t` is the caller's own translator (payrollDetail, a Server Component
 * translator obtained via getTranslations) -- this is a plain data-shaping
 * function, not a component, so it cannot call useTranslations() itself.
 */
export function deriveExceptions(
  slips: Array<{ employeeId: string; employeeName: string; status: string; issues?: string[] | undefined }>,
  t: (key: string) => string,
): PayrollException[] {
  const out: PayrollException[] = [];
  for (const s of slips) {
    const messages: string[] = [];
    if (s.status === "failed") messages.push(t("exceptionSalaryCalcFailed"));
    for (const code of s.issues ?? []) {
      messages.push(t(EXCEPTION_ISSUE_KEYS[code] ?? "exceptionOtherIssue"));
    }
    if (messages.length > 0) {
      out.push({ employeeId: s.employeeId, employeeName: s.employeeName, issue: messages.join(" ") });
    }
  }
  return out;
}
