import { z } from "zod";

export const FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;

/**
 * Closed set of voucher types a template can post as (GAP-FINANCE-RECURRING-
 * ENTRIES-04). These are the natures the cashbook voucher_type CHECK allows
 * (migration 0009) and the server's z.enum accepts; "transfer" is in the seeded
 * registry but the CHECK rejects it, so it is not offered. "journal" is the default.
 * Free text let a typo create a template no voucher type could ever match.
 */
export const VOUCHER_TYPES = [
  { value: "journal", label: "Journal" },
  { value: "payment", label: "Payment" },
  { value: "receipt", label: "Receipt" },
  { value: "contra", label: "Contra" },
  { value: "debit_note", label: "Debit Note" },
  { value: "credit_note", label: "Credit Note" },
] as const;

export type VoucherTypeValue = (typeof VOUCHER_TYPES)[number]["value"];

const voucherTypeSchema = z.enum(VOUCHER_TYPES.map((v) => v.value) as [VoucherTypeValue, ...VoucherTypeValue[]]);
const frequencySchema = z.enum(FREQUENCIES);

/** Zod check of the two closed-set selects at the form boundary. */
export function isValidVoucherType(v: string): v is VoucherTypeValue {
  return voucherTypeSchema.safeParse(v).success;
}
export function isValidFrequency(v: string): boolean {
  return frequencySchema.safeParse(v).success;
}

/**
 * Date rules (GAP-FINANCE-RECURRING-ENTRIES-06). All values are "YYYY-MM-DD"
 * calendar dates, so plain string comparison is correct; `today` must come from
 * todayIST() so the first 5.5 hours of an IST day are not judged in UTC.
 */
export function validateRunDates(
  nextRunDate: string,
  endDate: string,
  today: string,
): { nextRunDate?: string; endDate?: string } {
  const errors: { nextRunDate?: string; endDate?: string } = {};
  if (!nextRunDate) errors.nextRunDate = "Next run date is required.";
  else if (nextRunDate < today) errors.nextRunDate = "Next run date cannot be in the past.";
  if (endDate && nextRunDate && endDate < nextRunDate) {
    errors.endDate = "End date cannot be before the next run date.";
  }
  return errors;
}
