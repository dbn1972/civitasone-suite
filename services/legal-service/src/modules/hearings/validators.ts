import { z } from "zod";

export const createHearingBody = z.object({
  hearingDate: z.string(),
  court:       z.string().min(1).max(128),
  purpose:     z.string().max(256).optional(),
  nextDate:    z.string().optional(),
});
export type CreateHearingBody = z.infer<typeof createHearingBody>;

export const adjournBody = z.object({
  nextDate: z.string(),
  purpose:  z.string().max(256).optional(),
});
export type AdjournBody = z.infer<typeof adjournBody>;

export const recordOrderBody = z.object({
  orderType: z.string().min(1).max(32),
  direction: z.string().max(512).optional(),
  deptRef:   z.string().max(128).optional(),
  summary:   z.string().min(1).max(2000),
  orderDate: z.string(),
  // GAP-LEGAL-COURT-ORDERS-NEW-01: let the registrar record whether the order
  // requires compliance and by when, so the dashboard's Compliance-Due and
  // Contempt-Risk counts reflect real court directions.
  complianceRequired: z.boolean().optional(),
  complianceDeadline: z.string().optional(),
});
export type RecordOrderBody = z.infer<typeof recordOrderBody>;

export const caseHearingParams = z.object({
  id:  z.string().uuid(),
  hId: z.string().uuid(),
});
