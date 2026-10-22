/**
 * Pure rules shared by the posting consumer (gl/consumer.ts) and the synchronous pre-checks in gl/routes.ts. They live in
 * their own module (not gl/domain.ts) so a test that stubs domain.ts, as payroll-gl-consumer.test.ts does, still gets the
 * real rule.
 */

export type PeriodRefusalCode = "PERIOD_UNKNOWN" | "PERIOD_CLOSED" | "PERIOD_SOFT_CLOSED";

/**
 * The single rule for "may a journal of this type post into this period?", shared by the posting consumer
 * (gl/consumer.ts postJournal, the authority at posting time) and the synchronous pre-checks in gl/routes.ts
 * (GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-06), so a refusal the HTTP caller sees is exactly the one the consumer would
 * raise. `status` is a period-close status: "open" | "soft_close" | "hard_close" | "unknown" (a period string that is
 * not even shaped like YYYY-MM). Fails CLOSED on unknown; a soft-closed period accepts only adjustment/closing
 * journals. Returns null when the journal may post.
 */
export function periodPostingRefusal(
  status: string,
  journalType: string,
  period: string,
): { code: PeriodRefusalCode; message: string } | null {
  if (status === "unknown") return { code: "PERIOD_UNKNOWN", message: `cannot post to unrecognized period '${period}'` };
  if (status === "hard_close") return { code: "PERIOD_CLOSED", message: `cannot post to hard-closed period ${period}` };
  if (status === "soft_close" && !["adjustment", "closing"].includes(journalType)) {
    return { code: "PERIOD_SOFT_CLOSED", message: `only adjustment/closing journals allowed in soft-closed period ${period}` };
  }
  return null;
}

/**
 * A blank voucher number or the literal "AUTO" (any case) asks the GL to allocate the gapless number at approval time;
 * anything else is a number the officer typed, which must be unique per tenant (UNIQUE(tenant_id, voucher_no)).
 */
export function voucherNeedsAllocation(raw: string | null | undefined): boolean {
  return !raw || raw.trim() === "" || raw.toUpperCase() === "AUTO";
}
