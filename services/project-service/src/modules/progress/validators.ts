import { z } from "zod";

export const physicalProgressBody = z.object({
  componentId:   z.string().uuid().optional(),
  periodDate:    z.string().min(1),
  physicalPct:   z.number().min(0).max(100),
  notes:         z.string().max(1000).optional(),
});
export type PhysicalProgressBody = z.infer<typeof physicalProgressBody>;

export const financialProgressBody = z.object({
  periodDate:        z.string().min(1),
  expenditureMinor:  z.number().int().nonnegative(),
  notes:             z.string().max(1000).optional(),
});
export type FinancialProgressBody = z.infer<typeof financialProgressBody>;

export const dprBody = z.object({
  dprNo:     z.string().min(1).max(64),
  dprDate:   z.string().min(1),
  content:   z.record(z.unknown()).default({}),
});
export type DprBody = z.infer<typeof dprBody>;

/**
 * GAP-PROJECTS-DPR-TRACKING-01: a DPR review transition.
 *
 * The allowed status machine (matches progress.project_dprs's status CHECK:
 * submitted → under_review → approved | revision):
 *   - review:  submitted      → under_review   (reviewer picks it up)
 *   - approve: under_review    → approved       (terminal, favourable)
 *   - return:  under_review    → revision       (terminal: back to submitter)
 *
 * `reason` is REQUIRED for a return (it is the revision instruction the
 * submitter sees and is recorded on the audit event) and optional otherwise;
 * the route enforces the required-on-return rule after parsing so the message
 * is specific.
 */
export const dprTransitionBody = z.object({
  action: z.enum(["review", "approve", "return"]),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type DprTransitionBody = z.infer<typeof dprTransitionBody>;

export const dprIdParam = z.object({
  id:    z.string().uuid(),
  dprId: z.string().uuid(),
});

export const idParam = z.object({ id: z.string().uuid() });
