export type ApiOTRequest = {
  id: string;
  employeeId: string;
  // GAP-HR-OVERTIME-02: resolved server-side via the shared batchEmployees
  // helper (attendance/routes.ts), matching the ADVANCES-01/LOANS-01 pattern.
  employeeName?: string;
  employeeNo?: string;
  requestDate: string;
  hoursRequested: string;
  reason: string | null;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
};

export type Row = {
  id: string;
  employee: string;
  requestDate: string;
  // GAP-HR-OVERTIME-06: pre-formatted to 2 decimal places using integer
  // hundredths (no float summing/rounding drift), e.g. "2.50 h" instead of
  // the raw DB numeric string. A plain string needs no cellType/render.
  hoursDisplay: string;
  /** Raw numeric string, kept for GAP-HR-OVERTIME-05's approved-hours stat sum (see sumHoursHundredths). */
  hoursRequested: string;
  reason: string;
  status: string;
} & Record<string, unknown>;

export function mapOvertime(rows: ApiOTRequest[]): Row[] {
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    // GAP-HR-OVERTIME-02 acceptance: never a bare id; "Unknown employee"
    // when genuinely unresolved (mirrors GAP-HR-LOANS-01's own wording,
    // since this is the same "list row, not a form" context).
    employee: r.employeeName
      ? `${r.employeeName}${r.employeeNo ? ` (${r.employeeNo})` : ""}`
      : "Unknown employee",
    requestDate: r.requestDate,
    hoursDisplay: `${(Math.round(Number(r.hoursRequested) * 100) / 100).toFixed(2)} h`,
    hoursRequested: r.hoursRequested,
    reason: r.reason ?? "—",
    status: r.status,
  }));
}

/** Integer-hundredths sum to avoid float drift (GAP-HR-OVERTIME-06), returned as a decimal number. */
export function sumHoursHundredths(rows: Array<{ hoursRequested: string; status: string }>, statusFilter: (status: string) => boolean): number {
  const totalHundredths = rows
    .filter((r) => statusFilter(r.status))
    .reduce((sum, r) => sum + Math.round(Number(r.hoursRequested) * 100), 0);
  return totalHundredths / 100;
}
