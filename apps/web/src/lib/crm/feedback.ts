/**
 * GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05 — citizen feedback browser client.
 *
 * Submits a citizen's self-reported service rating (+ optional comment and an
 * optional "Regarding" service request) to crm-service via the BFF proxy. The
 * backend validates (zod), persists, and audits the write.
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export interface CitizenFeedbackInput {
  rating: number;
  comment?: string;
  serviceRequestId?: string;
  submissionType?: "anonymous" | "registered";
}

export async function submitCitizenFeedback(input: CitizenFeedbackInput): Promise<void> {
  const res = await browserFetch("v1/crm/citizen-feedback", {
    method: "POST",
    body: JSON.stringify({
      rating: input.rating,
      ...(input.comment && input.comment.trim() ? { comment: input.comment.trim() } : {}),
      ...(input.serviceRequestId ? { serviceRequestId: input.serviceRequestId } : {}),
      submissionType: input.submissionType ?? "anonymous",
    }),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}
