import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const quarterType = z.enum(["type_i", "type_ii", "type_iii", "type_iv", "type_v", "type_vi"]);

export const createQuarterBody = z.object({
  quarterNo:      z.string().min(1).max(64),
  quarterType:    quarterType.default("type_iv"),
  category:       z.string().max(32).default("general"),
  address:        z.string().max(512).optional(),
  locality:       z.string().max(200).optional(),
  carpetAreaSqft: z.number().int().positive().optional(),
  orgUnit:        z.string().max(64).optional(),
});
export type CreateQuarterBody = z.infer<typeof createQuarterBody>;

export const applyAllotmentBody = z.object({
  quarterId:       z.string().uuid(),
  employeeRef:     z.string().uuid(),
  designation:     z.string().max(120).optional(),
  payLevel:        z.string().max(16).optional(),
  seniorityMonths: z.number().int().nonnegative().default(0),
});
export type ApplyAllotmentBody = z.infer<typeof applyAllotmentBody>;

export const allotBody = z.object({
  version: z.number().int().positive(),
});
export type AllotBody = z.infer<typeof allotBody>;

export const occupyBody = z.object({
  version: z.number().int().positive(),
});
export type OccupyBody = z.infer<typeof occupyBody>;

export const vacationNoticeBody = z.object({
  version:         z.number().int().positive(),
  vacationDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type VacationNoticeBody = z.infer<typeof vacationNoticeBody>;

export const vacateBody = z.object({
  version:       z.number().int().positive(),
  handoverNotes: z.string().max(1000).optional(),
});
export type VacateBody = z.infer<typeof vacateBody>;

export const createLicenceFeeRateBody = z.object({
  quarterType:   quarterType,
  payLevel:      z.string().min(1).max(16),
  monthlyMinor:  z.number().int().positive(),
  currency:      z.string().length(3).default("INR"),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type CreateLicenceFeeRateBody = z.infer<typeof createLicenceFeeRateBody>;

export const quarterQueryParams = z.object({
  status: z.string().max(24).optional(),
  type:   z.string().max(16).optional(),
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
