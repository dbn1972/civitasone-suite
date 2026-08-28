import { z } from "zod";

export const caseIdParam = z.object({ id: z.string().uuid() });
export const directionIdParam = z.object({ id: z.string().uuid() });

/** Create a compliance direction on a case (§26). `caseId` comes from the URL path
 *  (see routes.ts), not the body — a duplicate `caseId` body field was previously
 *  accepted here but silently discarded in favor of the path value (Bug B). */
export const createDirectionBody = z.object({
  orderId:              z.string().uuid().optional(),
  direction:            z.string().trim().min(1).max(4000),
  responsibleAuthority: z.string().trim().max(120).optional(),
  dueDate:              z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD").optional(),
});
export type CreateDirectionBody = z.infer<typeof createDirectionBody>;

/** Record progress / close a compliance direction (§26). `expectedVersion` is the
 *  optimistic-lock token. */
export const updateComplianceBody = z.object({
  status:          z.enum(["in_progress", "completed", "verified", "non_compliant"]),
  progressNotes:   z.string().trim().max(4000).optional(),
  expectedVersion: z.coerce.number().int().min(1),
});
export type UpdateComplianceBody = z.infer<typeof updateComplianceBody>;
