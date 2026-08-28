import { z } from "zod";

export const caseIdParam = z.object({ id: z.string().uuid() });
export const copyIdParam = z.object({ id: z.string().uuid() });

/**
 * Apply for a certified copy of an order / judgment / case document (§30).
 *
 * `applicantName` is PII — it travels in the command payload only and is encrypted
 * at rest by the consumer (encryptedText column), never persisted or logged in
 * cleartext. `feeMinorHint` is a CLIENT hint only; when the tenant has a
 * `copy_fee` schedule configured the SERVER fee is authoritative and overrides it.
 *
 * `caseId` is deliberately NOT a body field: this route is scoped under
 * `/cases/:id/certified-copies`, so the URL param is the sole, authoritative
 * source of the case id (see commands.ts `requestCopy`). A body-level `caseId`
 * would either be redundant (matches the URL) or dangerously ambiguous (differs
 * from it) — dropping it removes the ambiguity outright rather than resolving it.
 */
export const requestCopyBody = z.object({
  orderId:      z.string().uuid().optional(),
  documentRef:  z.string().trim().max(512).optional(),
  applicantName: z.string().trim().max(200).optional(),
  copiesCount:  z.coerce.number().int().min(1).max(100).default(1),
  urgent:       z.boolean().optional(),
  // Client hint only — server overrides when a copy_fee config schedule exists.
  feeMinorHint: z.union([z.string(), z.number()]).optional(),
});
export type RequestCopyBody = z.infer<typeof requestCopyBody>;

/**
 * Transition a certified copy (§30). `expectedVersion` is the optimistic-lock
 * token.
 *
 * Payment proof (§30 integrity): moving to `fee_paid` REQUIRES BOTH a
 * `paymentRef` (the gateway / treasury challan reference) AND a `receiptMinor`
 * (the receipted amount, in PAISE) — a bare status flip with no evidence the
 * fee was actually collected is rejected here, before it ever reaches the
 * command bus. The consumer separately asserts `receiptMinor === feeMinor`
 * (domain.ts `assertReceiptMatchesFee`) since this schema alone cannot know the
 * server-authoritative fee.
 *
 * Rejection accountability: moving to `rejected` REQUIRES a non-empty `remarks`
 * explaining why — mirrors the sibling `recallReason`-required pattern for
 * recalling an issued order (client.ts `recallOrder`); an irreversible, adverse
 * action on a citizen's application should always carry a reason on record.
 */
export const transitionCopyBody = z
  .object({
    target:          z.enum(["fee_paid", "prepared", "issued", "rejected"]),
    deliveryMode:    z.string().trim().max(24).optional(),
    remarks:         z.string().trim().max(2000).optional(),
    expectedVersion: z.coerce.number().int().min(1),
    // Payment proof — required ONLY when target === "fee_paid" (enforced below).
    paymentRef:      z.string().trim().min(1).max(64).optional(),
    receiptMinor:    z.union([z.string(), z.number()]).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.target === "fee_paid") {
      if (!body.paymentRef) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paymentRef"],
          message: "paymentRef is required proof of payment when transitioning to fee_paid",
        });
      }
      if (body.receiptMinor === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["receiptMinor"],
          message: "receiptMinor is required proof of payment when transitioning to fee_paid",
        });
      }
    }
    if (body.target === "rejected" && !body.remarks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["remarks"],
        message: "remarks is required to explain why a certified copy is being rejected",
      });
    }
  });
export type TransitionCopyBody = z.infer<typeof transitionCopyBody>;
