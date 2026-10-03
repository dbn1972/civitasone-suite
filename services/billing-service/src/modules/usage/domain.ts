export function periodMonthFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── GAP-ADMIN-METERING-02: platform metering view ───────────────────────────
/** The usage metrics shown as columns, and the billing_usage metric key each one is recorded under. */
export const METERING_METRIC_KEYS = { apiCalls: "api_calls", storage: "storage_gb", users: "users" } as const;

/** Billing period (YYYY-MM) list, newest first, ending at `now`'s month. */
export function lastPeriods(now: Date, months: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** The metering screen's status vocabulary, derived from the period's invoice (if any). */
export function meteringStatus(invoiceStatus: string | undefined): string {
  switch (invoiceStatus) {
    case undefined: return "unbilled";
    case "draft": return "draft";
    case "issued":
    case "partially_paid": return "pending";
    case "paid": return "billed";
    case "overdue": return "overdue";
    default: return invoiceStatus; // waived | cancelled
  }
}
