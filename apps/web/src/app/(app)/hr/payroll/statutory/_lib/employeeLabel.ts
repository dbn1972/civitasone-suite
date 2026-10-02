/**
 * GAP-PAYROLL-STATUTORY-PF-04 / ESI-02 / GPF-05: display label for a ledger
 * row's employee. Prefers the HRMS name, then the real HR employee number when
 * the API supplies one, and otherwise a short 8-character code -- never the
 * full UUID (the enrichment fails open to null when HRMS is unreachable).
 * Same short-code convention as /hr/payroll/gpf.
 */
export function employeeLabel(employeeId: string, employeeName?: string | null, employeeCode?: string | null): string {
  if (employeeName && employeeName.trim()) return employeeName;
  if (employeeCode && employeeCode.trim()) return employeeCode;
  return (employeeId ?? "").slice(0, 8).toUpperCase();
}
