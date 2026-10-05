/**
 * GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05 — citizen feedback read model.
 */
import { cache } from "../../shared/infra.js";
import * as repo from "./feedback-repo.js";

export const FEEDBACK_RESOURCE = "citizen_feedback";

export async function getRatingsSummary(tenantId: string): Promise<repo.RatingsSummary> {
  return cache.listOrLoad(tenantId, FEEDBACK_RESOURCE, "ratings_summary", () =>
    repo.ratingsSummary(tenantId),
  );
}

export async function listForAdmin(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: repo.FeedbackView[]; total: number }> {
  // Deliberately NOT cached: rows carry the citizen comment (PII, plaintext column), and
  // Redis must never hold it at rest. Admin-only, low-volume, paged read — go to the DB.
  return repo.listForAdmin(tenantId, limit, offset);
}

export async function invalidateFeedback(tenantId: string): Promise<void> {
  await cache.invalidateResource(tenantId, FEEDBACK_RESOURCE);
}
