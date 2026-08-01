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

export const approveContractBody = z.object({
  note: z.string().max(500).optional(),
});
export type ApproveContractBody = z.infer<typeof approveContractBody>;

export const activateContractBody = z.object({
  note: z.string().max(500).optional(),
});
export type ActivateContractBody = z.infer<typeof activateContractBody>;

export const closeContractBody = z.object({
  note: z.string().max(500).optional(),
});
export type CloseContractBody = z.infer<typeof closeContractBody>;

export const terminateContractBody = z.object({
  reason: z.string().min(5).max(500),
});
export type TerminateContractBody = z.infer<typeof terminateContractBody>;

export const amendContractBody = z.object({
  reason:     z.string().min(5).max(500),
  valueDelta: z.number().int().default(0),
  newExpiry:  z.string().optional(),
});
export type AmendContractBody = z.infer<typeof amendContractBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const markMilestoneLateBody = z.object({
  achievedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "achievedDate must be YYYY-MM-DD"),
  notes: z.string().max(500).optional(),
});
export type MarkMilestoneLateBody = z.infer<typeof markMilestoneLateBody>;

export const completeMilestoneBody = z.object({
  achievedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "achievedDate must be YYYY-MM-DD"),
});
export type CompleteMilestoneBody = z.infer<typeof completeMilestoneBody>;

export const milestoneIdParam = z.object({
  id: z.string().uuid(),
  milestoneId: z.string().uuid(),
});

export const registerBondBody = z.object({
  bondType: z.enum(["performance", "bank_guarantee", "security_deposit"]).default("performance"),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3).default("INR"),
  issuer: z.string().min(1).max(256),
  referenceNo: z.string().min(1).max(128),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(1000).optional(),
});
export type RegisterBondBody = z.infer<typeof registerBondBody>;

export const transitionBondBody = z.object({
  toStatus: z.enum(["released", "claimed", "forfeited"]),
  notes: z.string().max(1000).optional(),
});
export type TransitionBondBody = z.infer<typeof transitionBondBody>;

export const bondIdParam = z.object({
  id: z.string().uuid(),
  bondId: z.string().uuid(),
});
