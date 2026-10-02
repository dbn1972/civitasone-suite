/**
 * GAP-PAYROLL-LOANS-06: shape + mapper for GET /v1/payroll/loans/:id/schedule
 * (payroll-service loans/routes.ts -- an amortisation preview: opening balance,
 * EMI, principal and interest split, closing balance per installment, all in
 * paise). The page used to ship a permanent "endpoint doesn't exist" empty card;
 * the endpoint exists, so the card now shows the real schedule.
 */
export type ScheduleInstallment = {
  installmentNo: number;
  openingMinor: number | string;
  emiMinor: number | string;
  principalMinor: number | string;
  interestMinor: number | string;
  closingMinor: number | string;
} & Record<string, unknown>;

export function mapLoanSchedule(p: unknown): ScheduleInstallment[] | null {
  const arr = (p as { schedule?: unknown } | null)?.schedule;
  if (!Array.isArray(arr)) return null;
  return arr.filter((r): r is ScheduleInstallment => !!r && typeof r === "object" && typeof (r as ScheduleInstallment).installmentNo === "number");
}

/** Which loan's schedule to show: the requested one if it belongs to this employee, else the first live loan, else the first loan. */
export function pickScheduleLoan<T extends { id: string; status: string }>(loans: readonly T[], requestedId: string | undefined): T | null {
  if (loans.length === 0) return null;
  return (
    loans.find((l) => l.id === requestedId) ??
    loans.find((l) => l.status === "active" || l.status === "disbursed") ??
    loans[0]
  );
}
