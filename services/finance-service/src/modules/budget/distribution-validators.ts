import { z } from "zod";

const FY = z.string().regex(/^\d{4}-\d{2}$/, "FY must be YYYY-YY");

export const createDistributionBody = z.object({
  allocationId:  z.string().uuid(),
  fromOfficeId:  z.string().uuid(),
  toOfficeId:    z.string().uuid(),
  amountMinor:   z.number().int().positive(),
  conditions:    z.string().max(2000).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency:      z.string().length(3).default("INR"),
});
export type CreateDistributionBody = z.infer<typeof createDistributionBody>;

export const acknowledgeBody = z.object({
  note: z.string().min(3).max(1000),
});
export type AcknowledgeBody = z.infer<typeof acknowledgeBody>;

export const distributionQuery = z.object({
  allocationId: z.string().uuid().optional(),
  fy:           FY.optional(),
  toOfficeId:   z.string().uuid().optional(),
  limit:        z.coerce.number().int().min(1).max(500).default(100),
});

export const idParam = z.object({ id: z.string().uuid() });
export const allocIdParam = z.object({ allocationId: z.string().uuid() });
