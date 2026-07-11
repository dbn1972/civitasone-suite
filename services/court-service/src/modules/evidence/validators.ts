import { z } from "zod";

export const caseIdParam = z.object({ id: z.string().uuid() });
export const evidenceIdParam = z.object({ id: z.string().uuid() });

/** Submit a piece of evidence/exhibit on a case (§22). */
export const submitEvidenceBody = z.object({
  caseId:        z.string().uuid(),
  filingId:      z.string().uuid().optional(),
  exhibitNumber: z.string().trim().max(32).optional(),
  title:         z.string().trim().min(1).max(500),
  evidenceType:  z.string().trim().min(1).max(32).optional(),
  storageRef:    z.string().trim().max(512).optional(),
  contentHash:   z.string().trim().regex(/^[0-9a-fA-F]{64}$/, "contentHash must be a 64-char hex SHA-256").optional(),
});
export type SubmitEvidenceBody = z.infer<typeof submitEvidenceBody>;

/** Rule on a submitted/marked exhibit (§22). `expectedVersion` is the optimistic-lock token. */
export const ruleEvidenceBody = z.object({
  ruling:          z.enum(["admitted", "rejected", "marked"]),
  rulingRemarks:   z.string().trim().max(2000).optional(),
  expectedVersion: z.coerce.number().int().min(1),
});
export type RuleEvidenceBody = z.infer<typeof ruleEvidenceBody>;
