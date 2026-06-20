import { z } from "zod";

export const createBeneficiaryBody = z.object({
  name:               z.string().min(2).max(256),
  type:               z.enum(["individual", "institution", "society", "mission"]).default("individual"),
  category:           z.string().optional(),
  age:                z.number().int().min(0).max(150).optional(),
  incomeAnnualMinor:  z.number().int().nonnegative().default(0),
  currency:           z.string().length(3).default("INR"),
  geography:          z.string().optional(),
});
export type CreateBeneficiaryBody = z.infer<typeof createBeneficiaryBody>;

export const linkBankBody = z.object({
  accountNoMasked: z.string().min(4).max(4, "must be exactly last 4 digits"),
  bankIfsc:        z.string().min(11).max(11),
  bankName:        z.string().optional(),
});
export type LinkBankBody = z.infer<typeof linkBankBody>;

export const seedAadhaarBody = z.object({
  aadhaar: z.string().regex(/^\d{12}$/, "Aadhaar must be exactly 12 digits"),
  bankAccountId: z.string().uuid().optional(),
});
export type SeedAadhaarBody = z.infer<typeof seedAadhaarBody>;

export const idParam = z.object({ id: z.string().uuid() });
