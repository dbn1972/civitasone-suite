/**
 * GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05 — citizen feedback zod validators.
 */
import { z } from "zod";

export const recordFeedbackBody = z.object({
  rating: z.number().int().min(1).max(5),
  // Free text the citizen typed. Bounded; may be omitted/empty. Trimmed so a
  // whitespace-only comment is stored as absent, not as a blank the UI must handle.
  comment: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  // Optional opaque reference to the service request this is "regarding".
  serviceRequestId: z.string().uuid().optional(),
  submissionType: z.enum(["anonymous", "registered"]).default("anonymous"),
});
export type RecordFeedbackBody = z.infer<typeof recordFeedbackBody>;
