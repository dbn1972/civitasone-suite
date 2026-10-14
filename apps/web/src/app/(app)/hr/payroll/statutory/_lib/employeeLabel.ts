/**
 * GAP-PAYROLL-STATUTORY-PF-04 / ESI-02 / GPF-05: display label for a ledger
 * row's employee. Prefers the HRMS name, then the real HR employee number when
 * the API supplies one, and otherwise the localised "Unknown employee" label.
 * SF-17b: never an id or an id fragment (the enrichment fails open to null when
 * HRMS is unreachable or the employee belongs to another tenant).
 */
export function employeeLabel(
  employeeName: string | null | undefined,
  employeeCode: string | null | undefined,
  unknownLabel: string,
): string {
  if (employeeName && employeeName.trim()) return employeeName;
  if (employeeCode && employeeCode.trim()) return employeeCode;
  return unknownLabel;
}
