import { eq, and, inArray } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { hrmsAssessmentResponses, type ResponseRow } from "./attempt-schema.js";

/** All responses across a set of attempts (for schedule-level item analysis). */
export async function listResponsesForAttempts(tenantId: string, attemptIds: string[]): Promise<ResponseRow[]> {
  if (attemptIds.length === 0) return [];
  return scopedRead((tx) => tx.select().from(hrmsAssessmentResponses)
    .where(and(eq(hrmsAssessmentResponses.tenantId, tenantId), inArray(hrmsAssessmentResponses.attemptId, attemptIds))));
}
