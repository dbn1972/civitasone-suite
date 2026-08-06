/**
 * Service Recovery — Zod validators for route-level input validation.
 */
import { z } from "zod";

export const ACTION_TYPES = ["goodwill_credit", "replacement", "priority_service", "apology_comm"] as const;

export const createPolicyBody = z.object({
  severityThreshold: z.enum(["low", "medium", "high", "critical"]),
  productCode: z.string().min(1).max(64).nullish(),
  maxGoodwillMinor: z.coerce.bigint().positive(),
  currency: z.string().length(3).default("INR"),
  requiresApproval: z.boolean().default(true),
  approverRole: z.string().min(1).max(64).default("helpdesk_manager"),
  active: z.boolean().default(true),
});

export const createActionBody = z.object({
  policyId: z.string().uuid(),
  actionType: z.enum(ACTION_TYPES),
  amountMinor: z.coerce.bigint().positive().nullish(),
  currency: z.string().length(3).default("INR"),
  reason: z.string().min(1).max(2000).optional(),
});

export const approveRejectBody = z.object({
  reason: z.string().min(1).max(2000).optional(),
});

export const idParam = z.object({ id: z.string().uuid() });
export const ticketIdParam = z.object({ ticketId: z.string().uuid() });

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type CreatePolicyInput = z.infer<typeof createPolicyBody>;
export type CreateActionInput = z.infer<typeof createActionBody>;
