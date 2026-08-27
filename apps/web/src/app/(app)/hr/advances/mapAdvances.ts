export type ApiAdvance = {
  id: string;
  employeeId?: string;
  // The backend (services/hrms-service's hrms_salary_advances table) never
  // actually nests this -- it only ever returns a flat employeeId -- but
  // keep the optional nested shape too in case a future join adds it.
  employee?: { name?: string; employeeNo?: string };
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
  amount: string;
  purpose: string;
  recoveryMonths: string;
  recovered: string;
  requestDate: string;
  status: string;
} & Record<string, unknown>;

function formatINR(minor: number | undefined): string {
  if (minor == null) return "—";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

export function mapAdvances(rows: ApiAdvance[]): Row[] {
  return rows.map((a) => ({
    id: a.id,
    // Regression: the backend never nests an "employee" object (only a
    // flat employeeId), so this always rendered "--" for every row. Fall
    // back to the id so the row is at least identifiable instead of blank.
    employee: a.employee?.name
      ? `${a.employee.name} (${a.employee.employeeNo ?? "—"})`
      : a.employeeId ?? "—",
    amount: formatINR(a.amountMinor),
    purpose: a.purpose ?? "—",
    recoveryMonths: `${String(a.recoveryMonths).padStart(2, "0")} mo`,
    recovered: formatINR(a.recoveredMinor),
    requestDate: a.requestDate ?? a.created_at ?? "—",
    status: a.status ?? "pending",
  }));
}
