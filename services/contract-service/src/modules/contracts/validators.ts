import { z } from "zod";

const milestoneSchema = z.object({
  title:       z.string().min(1).max(256),
  dueDate:     z.string(),
  amountMinor: z.number().int().nonnegative(),
  currency:    z.string().length(3).default("INR"),
});

export const createContractBody = z.object({
  contractNo: z.string().min(1).max(64),
  vendorId:   z.string().uuid(),
  poRef:      z.string().optional(),
  title:      z.string().min(1).max(256),
  valueMinor: z.number().int().positive(),
  currency:   z.string().length(3).default("INR"),
  startDate:  z.string(),
  expiry:     z.string(),
  slaTerms:   z.record(z.unknown()).optional(),
  milestones: z.array(milestoneSchema).optional(),
});
export type CreateContractBody = z.infer<typeof createContractBody>;

export const amendContractBody = z.object({
  reason:     z.string().min(5).max(500),
  valueDelta: z.number().int().default(0),
  newExpiry:  z.string().optional(),
});
export type AmendContractBody = z.infer<typeof amendContractBody>;

export const idParam = z.object({ id: z.string().uuid() });
