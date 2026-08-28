import { z } from "zod";

export const caseIdParam = z.object({ id: z.string().uuid() });
export const scrutinyIdParam = z.object({ id: z.string().uuid() });
export const defectIdParam = z.object({ id: z.string().uuid() });

/** Record the registry scrutiny of a filed case (§13). `caseId` comes from the URL
 *  path (see routes.ts), not the body — a duplicate `caseId` body field was
 *  previously accepted here but silently discarded in favor of the path value
 *  (Bug B). */
export const recordScrutinyBody = z.object({
  status:  z.enum(["pending", "cleared", "defective"]).optional(),
  remarks: z.string().trim().max(2000).optional(),
});
export type RecordScrutinyBody = z.infer<typeof recordScrutinyBody>;

/** Raise a defect against a scrutinized case (§13). `caseId` comes from the URL path
 *  (see routes.ts), not the body — same Bug B as recordScrutinyBody above. */
export const raiseDefectBody = z.object({
  category:              z.string().trim().min(1).max(48),
  description:           z.string().trim().min(1).max(2000),
  severity:              z.enum(["minor", "major", "critical"]).optional(),
  rectificationDeadline: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "rectificationDeadline must be YYYY-MM-DD").optional(),
});
export type RaiseDefectBody = z.infer<typeof raiseDefectBody>;

/** Resolve a raised defect (§13). `expectedVersion` is the optimistic-lock token. */
export const resolveDefectBody = z.object({
  resolution:      z.enum(["rectified", "waived", "rejected"]),
  expectedVersion: z.coerce.number().int().min(1),
});
export type ResolveDefectBody = z.infer<typeof resolveDefectBody>;

/** Resolve a scrutiny (§13). `expectedVersion` is the optimistic-lock token. */
export const resolveScrutinyBody = z.object({
  status:          z.enum(["cleared", "defective"]),
  expectedVersion: z.coerce.number().int().min(1),
});
export type ResolveScrutinyBody = z.infer<typeof resolveScrutinyBody>;
