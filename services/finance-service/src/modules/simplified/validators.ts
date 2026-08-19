import { z } from "zod";

/** Monetary amount in paise (minor units). Accepts digit-string or bigint; outputs bigint. */
const zMoneyMinor = z
  .union([
    z.string().regex(/^\d+$/, "amount must be whole number in paise"),
    z.bigint().nonnegative(),
  ])
  .pipe(z.bigint().nonnegative());

/** GST rate as a percentage (0, 5, 12, 18, 28). */
const gstRate = z.number().int().min(0).max(28).default(0);

/** Period string: YYYY-MM */
const periodParam = z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM");

export const recordIncomeBody = z.object({
  amount:       zMoneyMinor,
  customerName: z.string().min(1).max(200),
  description:  z.string().max(500).optional(),
  gstRate:      gstRate,
  invoiceNo:    z.string().max(64).optional(),
  incomeType:   z.enum(["sales", "service", "other"]).default("sales"),
  postingDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type RecordIncomeBody = z.infer<typeof recordIncomeBody>;

export const recordExpenseBody = z.object({
  amount:       zMoneyMinor,
  category:     z.string().min(1).max(64),
  vendorName:   z.string().min(1).max(200).optional(),
  description:  z.string().max(500).optional(),
  gstRate:      gstRate,
  postingDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type RecordExpenseBody = z.infer<typeof recordExpenseBody>;

export const recordPaymentReceivedBody = z.object({
  amount:       zMoneyMinor,
  customerName: z.string().min(1).max(200),
  invoiceNo:    z.string().max(64).optional(),
  postingDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type RecordPaymentReceivedBody = z.infer<typeof recordPaymentReceivedBody>;

export const recordPaymentMadeBody = z.object({
  amount:       zMoneyMinor,
  vendorName:   z.string().min(1).max(200),
  description:  z.string().max(500).optional(),
  postingDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type RecordPaymentMadeBody = z.infer<typeof recordPaymentMadeBody>;

export const summaryQuery = z.object({
  period: periodParam.optional(),
});
export type SummaryQuery = z.infer<typeof summaryQuery>;

export const listQuery = z.object({
  from:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit:  z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type ListQuery = z.infer<typeof listQuery>;
