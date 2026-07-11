import { z } from "zod";

export const orderIdParam = z.object({ id: z.string().uuid() });

/** Submit a drafted order for approval (§23). `expectedVersion` is the
 *  optimistic-lock token read from the current order row. */
export const submitForApprovalBody = z.object({
  expectedVersion: z.coerce.number().int().min(1),
});
export type SubmitForApprovalBody = z.infer<typeof submitForApprovalBody>;

/** Approve + issue (pronounce) an order (§23 + §35.5). `dscSignature` is the
 *  detached Digital Signature Certificate blob applied by the human checker;
 *  `issuedDate` (optional) overrides the pronouncement calendar date. */
export const approveAndIssueBody = z.object({
  dscSignature:    z.string().trim().min(1).max(4000),
  issuedDate:      z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "issuedDate must be YYYY-MM-DD").optional(),
  expectedVersion: z.coerce.number().int().min(1),
});
export type ApproveAndIssueBody = z.infer<typeof approveAndIssueBody>;

/** Send a pending order back to its maker for revision (§23). */
export const sendBackBody = z.object({
  remarks:         z.string().trim().max(2000).optional(),
  expectedVersion: z.coerce.number().int().min(1),
});
export type SendBackBody = z.infer<typeof sendBackBody>;

/** Recall an already-issued order (§23). `recallReason` is mandatory. */
export const recallBody = z.object({
  recallReason:    z.string().trim().min(1).max(2000),
  expectedVersion: z.coerce.number().int().min(1),
});
export type RecallBody = z.infer<typeof recallBody>;
