import { z } from "zod";
import { AMENDMENT_TYPES } from "./amendment-domain.js";

export const requestAmendmentBody = z.object({
  amendmentType: z.enum(AMENDMENT_TYPES).default("scope"),
  reason:        z.string().min(3).max(1000),
  // Signed change in PO value (paise). Negative reduces scope; 0 for pure scope/schedule.
  deltaMinor:    z.number().int().default(0),
  effectiveDate: z.string().optional(),
});
export type RequestAmendmentBody = z.infer<typeof requestAmendmentBody>;

export const approveAmendmentBody = z.object({
  notes: z.string().max(500).optional(),
});
export type ApproveAmendmentBody = z.infer<typeof approveAmendmentBody>;

export const rejectAmendmentBody = z.object({
  reason: z.string().min(1).max(500),
});
export type RejectAmendmentBody = z.infer<typeof rejectAmendmentBody>;

export const addMilestoneBody = z.object({
  title:       z.string().min(1).max(256),
  description: z.string().max(1000).optional(),
  dueDate:     z.string().optional(),
  amountMinor: z.number().int().nonnegative().default(0),
});
export type AddMilestoneBody = z.infer<typeof addMilestoneBody>;

export const updateMilestoneBody = z.object({
  status:       z.enum(["pending", "in_progress", "delivered", "delayed", "closed"]),
  deliveredQty: z.number().int().nonnegative().optional(),
});
export type UpdateMilestoneBody = z.infer<typeof updateMilestoneBody>;

export const closePoBody = z.object({
  notes: z.string().max(500).optional(),
});
export type ClosePoBody = z.infer<typeof closePoBody>;

export const poIdParam = z.object({ id: z.string().uuid() });
export const amendmentIdParam = z.object({ id: z.string().uuid(), amendmentId: z.string().uuid() });
export const milestoneIdParam = z.object({ id: z.string().uuid(), milestoneId: z.string().uuid() });
