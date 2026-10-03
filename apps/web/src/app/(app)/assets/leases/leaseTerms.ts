/**
 * GAP-ASSETS-LEASES-07: pure helpers for the lease form's optional discounting inputs.
 * A lease with a discount rate (IBR) and a periodic payment gets its liability computed
 * by the service (present value of the payments) plus an amortisation schedule.
 */

/** "8", "8.5", "12.25" (percent per annum) -> basis points (800, 850, 1225); null when invalid or above 100%. */
export function percentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bps <= 10_000 ? bps : null;
}

export type LeaseFrequency = "monthly" | "quarterly" | "annual";
export const LEASE_FREQUENCIES: ReadonlyArray<{ value: LeaseFrequency; label: string }> = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
];

/** True when the clerk filled either discounting field (both are then required). */
export function isDiscounted(ibr: string, payment: string): boolean {
  return ibr.trim() !== "" || payment.trim() !== "";
}

export type LeaseScheduleRow = {
  seq: number;
  dueDate: string;
  openingMinor: string;
  interestMinor: string;
  paymentMinor: string;
  principalMinor: string;
  closingMinor: string;
};

export function parseSchedule(payload: unknown): LeaseScheduleRow[] | null {
  if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { data?: unknown }).data)) return null;
  const rows: LeaseScheduleRow[] = [];
  for (const r of (payload as { data: unknown[] }).data) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    const s = (k: string) => (typeof o[k] === "string" && /^\d+$/.test(o[k] as string) ? (o[k] as string) : null);
    const [opening, interest, payment, principal, closing] = ["openingMinor", "interestMinor", "paymentMinor", "principalMinor", "closingMinor"].map(s);
    if (typeof o.seq !== "number" || typeof o.dueDate !== "string" || opening === null || interest === null || payment === null || principal === null || closing === null) continue;
    rows.push({ seq: o.seq, dueDate: o.dueDate, openingMinor: opening, interestMinor: interest, paymentMinor: payment, principalMinor: principal, closingMinor: closing });
  }
  return rows;
}
