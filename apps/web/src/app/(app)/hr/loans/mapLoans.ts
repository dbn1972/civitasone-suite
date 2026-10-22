/**
 * GAP-HR-LOANS-01/03/05: API -> register-row mapping, split out of page.tsx
 * (a Next page file may only export its default component and route config) so
 * it can be unit-tested directly.
 */
export type ApiLoan = {
  id: string;
  employeeId: string;
  employeeName?: string;
  department?: string;
  loanType: string;
  sanctionedAmountMinor: number;
  emiMinor: number;
  outstandingMinor: number;
  totalEmis: number;
  emisPaid: number;
  status: string;
};

export type Row = {
  id: string;
  employee: string;
  department: string;
  loanType: string;
  sanctionedAmount: number | null;
  emi: number | null;
  balance: number | null;
  /** "3 / 12", or a dash when the loan has no instalment schedule (totalEmis 0). Kept as text for sort / filter / CSV. */
  emiProgress: string;
  /** Raw counts so LoansTable can draw a progress bar; never used for money. */
  emisPaid: number;
  totalEmis: number;
  status: string;
} & Record<string, unknown>;

export function mapLoans(apiLoans: ApiLoan[], loanTypeLabel: (code: string) => string): Row[] {
  return apiLoans.map((l) => {
    const totalEmis = Number.isFinite(l.totalEmis) ? l.totalEmis : 0;
    const emisPaid = Number.isFinite(l.emisPaid) ? l.emisPaid : 0;
    return {
      id: l.id,
      // GAP-HR-LOANS-01: employeeName/department are now resolved server-side
      // (loans-routes.ts, via the shared batchEmployees/batchDepartments
      // helper) -- "Unknown employee" (not the raw UUID) when genuinely absent,
      // per this item's own acceptance text.
      employee: l.employeeName ?? "Unknown employee",
      department: l.department ?? "—",
      loanType: loanTypeLabel(l.loanType),
      sanctionedAmount: l.sanctionedAmountMinor ?? null,
      emi: l.emiMinor != null ? l.emiMinor : null,
      balance: l.outstandingMinor != null ? l.outstandingMinor : null,
      // GAP-HR-LOANS-03: instalment progress as "x / y"; a loan with no
      // schedule (totalEmis 0) is a dash -- never "0 / 0" and never a
      // division by zero.
      emiProgress: totalEmis > 0 ? `${emisPaid} / ${totalEmis}` : "—",
      emisPaid,
      totalEmis,
      status: l.status,
    };
  });
}
