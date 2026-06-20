import { z } from "zod";

export const deptResponseBody = z.object({
  responseBody:   z.string().min(1).max(8000),
  respondedByRef: z.string().min(1).max(128),
});
export type DeptResponseBody = z.infer<typeof deptResponseBody>;

export const settleBody = z.object({
  reason: z.string().max(500).optional(),
});
export type SettleBody = z.infer<typeof settleBody>;

export const pendingRecoveryBody = z.object({
  reason:   z.string().max(500).optional(),
  dueDate:  z.string().optional(),
});
export type PendingRecoveryBody = z.infer<typeof pendingRecoveryBody>;

export const closeBody = z.object({
  reason: z.string().max(500).optional(),
});
export type CloseBody = z.infer<typeof closeBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const listParasQuery = z.object({
  status:  z.enum(["draft", "issued", "replied", "settled", "pending_recovery", "closed"]).optional(),
  deptRef: z.string().optional(),
  limit:   z.coerce.number().int().min(1).max(200).default(50),
  offset:  z.coerce.number().int().min(0).default(0),
});
