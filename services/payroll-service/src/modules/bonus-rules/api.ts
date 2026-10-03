import { z } from "zod";

const minor = z.string().regex(/^\d{1,12}$/, "amount in paise as a digit string");

export const createBonusRuleBody = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveFrom must be YYYY-MM-DD"),
  wageCeilingMinor: minor.nullable().optional(),
  eligibilityCeilingMinor: minor.nullable().optional(),
  minBonusBps: z.number().int().min(0).max(10000).nullable().optional(),
  maxBonusBps: z.number().int().min(0).max(10000).nullable().optional(),
  changeReason: z.string().trim().min(10).max(500),
}).refine((b) => b.minBonusBps == null || b.maxBonusBps == null || b.minBonusBps <= b.maxBonusBps,
  { message: "minBonusBps must not exceed maxBonusBps", path: ["minBonusBps"] });
export type CreateBonusRuleBody = z.infer<typeof createBonusRuleBody>;
