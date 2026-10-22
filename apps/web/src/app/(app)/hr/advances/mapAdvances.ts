export type ApiAdvance = {
  id: string;
  employeeId?: string;
  // GAP-HR-ADVANCES-01: the backend (loans-routes.ts) now resolves these two
  // flat fields via the shared batchEmployees helper -- matching the shape
  // hr/loans/page.tsx already expects for the sibling loans register.
  employeeName?: string;
  employeeNo?: string;
  amountMinor: number;
  purpose: string;
  recoveryMonths: number;
  recoveredMinor?: number;
  requestDate?: string;
  status: string;
  created_at?: string;
};

export type Row = {
  id: string;
  employee: string;
  amount: number;
  purpose: string;
  recoveryMonths: string;
  recovered: number;
  requestDate: string;
  // GAP-HR-ADVANCES-02: the API/DB status stays "active" on approve (see
  // loans-consumer.ts's doc comment on why that value is not renamed --
  // an existing report may already read the raw column). Only the WEB
  // display value is remapped to "approved" here, decoupling the
  // user-facing label from the storage vocabulary without touching the
  // wire contract; page.tsx's stat-card count reads this same mapped field
  // so the two always agree.
  status: string;
  rawStatus: string;
  canDecide: boolean;
} & Record<string, unknown>;

/**
 * GAP-HR-ADVANCES-07: the Recovery column's wording ("1 month" / "6 months")
 * used to be built here in English. The caller now supplies the formatter
 * (page.tsx passes advances.recoveryMonthsValue, an ICU plural), so the unit
 * is localised; an unknown / non-finite count stays a dash.
 */
function recoveryLabel(n: number, formatMonths: (months: number) => string): string {
  if (!Number.isFinite(n)) return "—";
  return formatMonths(n);
}

export function mapAdvances(rows: ApiAdvance[], formatMonths: (months: number) => string): Row[] {
  return rows.map((a) => ({
    id: a.id,
    // Acceptance (GAP-HR-ADVANCES-01): missing name renders "—", never a
    // UUID -- note this differs from the sibling loans register
    // (GAP-HR-LOANS-01), which uses "Unknown employee"; each page's own
    // catalog acceptance text specifies its own wording.
    employee: a.employeeName
      ? `${a.employeeName}${a.employeeNo ? ` (${a.employeeNo})` : ""}`
      : "—",
    amount: a.amountMinor ?? 0,
    purpose: a.purpose ?? "—",
    recoveryMonths: recoveryLabel(a.recoveryMonths, formatMonths),
    recovered: a.recoveredMinor ?? 0,
    requestDate: a.requestDate ?? a.created_at ?? "—",
    status: a.status === "active" ? "approved" : (a.status ?? "pending"),
    rawStatus: a.status ?? "pending",
    canDecide: (a.status ?? "pending") === "pending",
  }));
}
