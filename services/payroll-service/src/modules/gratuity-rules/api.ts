import { z } from "zod";

export const createGratuityRuleBody = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveFrom must be YYYY-MM-DD"),
  ruleSet: z.enum(["pog_act", "ccs_dcrg"]),
  minServiceYears: z.number().int().min(0).max(40),
  ceilingMinor: z.string().regex(/^\d{1,12}$/, "ceiling in paise as a digit string"),
  changeReason: z.string().trim().min(10).max(500),
});
export type CreateGratuityRuleBody = z.infer<typeof createGratuityRuleBody>;
