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

function pluralMonths(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n === 1 ? "1 month" : `${n} months`;
}

export function mapAdvances(rows: ApiAdvance[]): Row[] {
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
    recoveryMonths: pluralMonths(a.recoveryMonths),
    recovered: a.recoveredMinor ?? 0,
    requestDate: a.requestDate ?? a.created_at ?? "—",
    status: a.status === "active" ? "approved" : (a.status ?? "pending"),
    rawStatus: a.status ?? "pending",
    canDecide: (a.status ?? "pending") === "pending",
  }));
}
