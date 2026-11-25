import { z } from "zod";

export const createPlanBody = z.object({
  planNo:     z.string().min(1).max(64),
  title:      z.string().min(1).max(256),
  area:       z.string().min(1).max(128),
  // ISO-8601 date strings (YYYY-MM-DD); both are validated as real dates
  // and periodFrom must be <= periodTo.
  periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date"),
  periodTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date"),
  riskLevel:  z.enum(["low", "medium", "high"]).default("medium"),
}).refine(
  (b) => b.periodFrom <= b.periodTo,
  { message: "periodFrom must not be after periodTo", path: ["periodFrom"] },
);
export type CreatePlanBody = z.infer<typeof createPlanBody>;

export const createPlanItemBody = z.object({
  deptRef:       z.string().min(1).max(128),
  unitRef:       z.string().max(128).optional(),
  scheduledFrom: z.string(),
  scheduledTo:   z.string(),
});
export type CreatePlanItemBody = z.infer<typeof createPlanItemBody>;

export const idParam = z.object({ id: z.string().uuid() });

// GAP-AUDIT-PLAN-05: a deferral must say why; the reason is persisted (plan.audit_plans.defer_reason) and audited.
export const deferPlanBody = z.object({
  reason: z.string().trim().min(3, "a defer reason is required").max(2000),
});
export type DeferPlanBody = z.infer<typeof deferPlanBody>;
