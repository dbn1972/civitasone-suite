import { z } from "zod";

export const approveArrearBody = z.object({ note: z.string().trim().max(512).optional() });
/** A rejection must say why. */
export const rejectArrearBody = z.object({ note: z.string().trim().min(1).max(512) });
export const arrearPolicyBody = z.object({
  /** true => the run pays only APPROVED manual arrears (maker != checker). */
  required: z.boolean(),
  reason: z.string().trim().min(10).max(500),
});
export type ArrearPolicyBody = z.infer<typeof arrearPolicyBody>;

export type ArrearDecision = "approved" | "rejected";
