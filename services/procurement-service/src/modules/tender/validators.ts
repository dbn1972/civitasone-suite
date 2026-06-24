import { z } from "zod";

export const createTenderBody = z.object({
  title:          z.string().min(1).max(300),
  scope:          z.string().max(4000).optional(),
  eligibility:    z.string().max(4000).optional(),
  type:           z.enum(["open", "limited", "single_source", "gem"]).default("open"),
  estimatedMinor: z.number().int().nonnegative().default(0),
  emdAmountMinor: z.number().int().nonnegative().default(0),
  bidClosingDate: z.string().min(1),
});
export type CreateTenderBody = z.infer<typeof createTenderBody>;

// Two sealed envelopes submitted together: technical fields + a SEPARATE
// financialAmountMinor that gets stored sealed.
export const submitBidBody = z.object({
  vendorId:             z.string().uuid(),
  vendorName:           z.string().max(300).default(""),
  technicalScore:       z.number().int().min(0).max(100).optional(),
  financialAmountMinor: z.number().int().nonnegative(),
});
export type SubmitBidBody = z.infer<typeof submitBidBody>;

export const techEvaluateBody = z.object({
  results: z.array(z.object({
    bidId:     z.string().uuid(),
    qualified: z.boolean(),
    score:     z.number().int().min(0).max(100).optional(),
    notes:     z.string().max(1000).optional(),
  })).min(1),
});
export type TechEvaluateBody = z.infer<typeof techEvaluateBody>;

export const idParam = z.object({ id: z.string().uuid() });
