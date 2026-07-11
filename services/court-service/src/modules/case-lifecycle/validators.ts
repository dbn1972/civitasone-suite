import { z } from "zod";
import { CASE_STATUSES } from "../case-registry/domain.js";

export const caseIdParam = z.object({ id: z.string().uuid() });

/**
 * Move a case to a new lifecycle state (§11). `expectedVersion` is the caller's
 * optimistic-lock token (the version they last read); a concurrent modification
 * makes it stale and the transition is rejected rather than silently lost.
 */
export const updateCaseStatusBody = z.object({
  toStatus:        z.enum(CASE_STATUSES),
  expectedVersion: z.coerce.number().int().min(1),
  reason:          z.string().trim().max(1000).optional(),
});
export type UpdateCaseStatusBody = z.infer<typeof updateCaseStatusBody>;
