import { z } from "zod";

/**
 * Dearness Allowance rate entry. Rates are effective-dated, one series per
 * tenant. resolveDaRateBps() picks the latest row whose effective_from is on or
 * before the 1st of the payroll month, so every entry takes effect on the 1st
 * of a month (DA orders are effective 1 January / 1 July).
 */
export const createDaRateBody = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-01$/, "effectiveFrom must be the first day of a month (YYYY-MM-01)"),
  // 5000 = 50.00%. 0 is valid: it records an explicit "no DA" decision.
  rateBps: z.number().int().min(0).max(20000),
  orderRef: z.string().trim().min(10, "orderRef must cite the government order").max(300),
}).refine((b) => !Number.isNaN(Date.parse(b.effectiveFrom)), { message: "effectiveFrom is not a valid date", path: ["effectiveFrom"] });
export type CreateDaRateBody = z.infer<typeof createDaRateBody>;
