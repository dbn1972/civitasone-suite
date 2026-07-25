import { z } from "zod";

export const createPlanBody = z.object({
  planYear:           z.number().int().min(1900).max(3000),
  unitId:             z.string().uuid(),
  cadre:              z.string().min(1).max(120),
  designationId:      z.string().uuid().optional(),
  requiredStrength:   z.number().int().nonnegative().default(0),
  sanctionedStrength: z.number().int().nonnegative().default(0),
  filledStrength:     z.number().int().nonnegative().default(0),
  remarks:            z.string().max(2000).optional(),
});
export type CreatePlanBody = z.infer<typeof createPlanBody>;

export const updatePlanBody = z.object({
  requiredStrength:   z.number().int().nonnegative().optional(),
  sanctionedStrength: z.number().int().nonnegative().optional(),
  filledStrength:     z.number().int().nonnegative().optional(),
  remarks:            z.string().max(2000).optional(),
});
export type UpdatePlanBody = z.infer<typeof updatePlanBody>;

const rosterCategory = z.enum(["SC", "ST", "OBC", "EWS", "UR", "PwD"]);

/** Manual category-wise roster inputs (override the auto-allocation). */
export const setRosterBody = z.object({
  entries: z.array(z.object({
    category:      rosterCategory,
    reservedCount: z.number().int().nonnegative(),
  })).min(1).max(6),
});
export type SetRosterBody = z.infer<typeof setRosterBody>;

export const approvePlanBody = z.object({
  refNoPrefix: z.string().min(1).max(40).optional(),
  title:       z.string().min(1).max(256).optional(),
  remarks:     z.string().max(2000).optional(),
});
export type ApprovePlanBody = z.infer<typeof approvePlanBody>;

export const advertiseRequisitionBody = z.object({
  advertisementRef: z.string().min(1).max(200),
});
export type AdvertiseRequisitionBody = z.infer<typeof advertiseRequisitionBody>;

export const idParam = z.object({ id: z.string().uuid() });
