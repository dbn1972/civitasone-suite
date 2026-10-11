/**
 * applyPosting — request validation (SmartTransfer OS, ST-M01-09).
 *
 * The HTTP body mirrors the frozen `hrms.posting.apply` command contract
 * (packages/events, #1976): the fields SmartTransfer sends when it asks HRMS to
 * apply a posting for a signed order. `orderId` is the IDEMPOTENCY KEY — the
 * deterministic command messageId is derived from it (never the employee or
 * post id), so a redelivery of the same order is a no-op (house rule 1).
 */
import { z } from "zod";

/** Charge types that a posting may carry (mirrors the DB CHECK constraint). */
export const chargeTypeEnum = z.enum([
  "substantive",
  "acting",
  "additional",
  "in_charge",
]);

export const applyPostingBody = z.object({
  /** The movement ORDER id this apply is for. Idempotency key. */
  orderId: z.string().uuid(),
  /** The employee being posted. */
  employeeId: z.string().uuid(),
  /** The target sanctioned post (workforce_core.post.id). */
  postId: z.string().uuid(),
  /** The date the posting takes effect (YYYY-MM-DD). */
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  /** The order number as printed on the signed order. */
  orderNumber: z.string().min(1).max(128),
  /** Placement kind; defaults to a substantive posting. */
  chargeType: chargeTypeEnum.default("substantive"),
  /**
   * SoD: the actor who APPROVED the order, when the current path enforces
   * maker ≠ approver. Optional — only paths that already carry an approver
   * supply it; the consumer refuses only when it IS supplied and equals the
   * maker (it never invents a new approval rule — D-ST-08/18 are PROPOSED).
   */
  approvedBy: z.string().uuid().optional(),
});

export type ApplyPostingBody = z.infer<typeof applyPostingBody>;
