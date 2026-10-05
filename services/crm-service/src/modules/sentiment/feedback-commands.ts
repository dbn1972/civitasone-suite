/**
 * GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05 — citizen feedback CQRS write path.
 * The route validates (zod), publishes this command and returns 202; the
 * consumer applies the write + emits the audit event inside one transaction.
 */
import type { RequestContext } from "@civitasone/types";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand, type Accepted } from "../../shared/residual-publish.js";
import type { RecordFeedbackBody } from "./feedback-validators.js";

export const recordCitizenFeedback = (
  ctx: RequestContext,
  id: string,
  body: RecordFeedbackBody,
): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.recordCitizenFeedback, id, {
    rating: body.rating,
    comment: body.comment ?? null,
    serviceRequestId: body.serviceRequestId ?? null,
    submissionType: body.submissionType,
  });
