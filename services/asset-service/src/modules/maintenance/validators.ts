import { z } from "zod";

export const maintenancePlanBody = z.object({
  frequency:      z.string().min(1).max(16).default("monthly"),
  triggerType:    z.enum(["calendar", "meter", "condition", "both"]).default("calendar"),
  meterType:      z.enum(["odometer", "hours_run", "cycles", "temperature", "vibration", "custom"]).optional(),
  meterThreshold: z.number().positive().optional(),
  nextDue:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description:    z.string().optional(),
});
export type MaintenancePlanBody = z.infer<typeof maintenancePlanBody>;

export const meterReadingBody = z.object({
  meterType:    z.enum(["odometer", "hours_run", "cycles", "temperature", "vibration", "custom"]),
  readingValue: z.number().positive(),
  unit:         z.string().min(1).max(16).default("km"),
  readingDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source:       z.enum(["manual", "iot", "mobile"]).default("manual"),
  notes:        z.string().optional(),
});
export type MeterReadingBody = z.infer<typeof meterReadingBody>;

export const impairmentTestBody = z.object({
  testDate:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fairValueMinor:     z.number().int().nonnegative().optional(),
  disposalCostsMinor: z.number().int().nonnegative().default(0),
  valueInUseMinor:    z.number().int().nonnegative().optional(),
  discountRateBps:    z.number().int().min(0).max(10000).optional(),
  projectionYears:    z.number().int().min(1).max(50).optional(),
  cguId:              z.string().uuid().optional(),
  cguName:            z.string().optional(),
  notes:              z.string().optional(),
});
export type ImpairmentTestBody = z.infer<typeof impairmentTestBody>;

export const workOrderBody = z.object({
  assetId:       z.string().uuid(),
  planId:        z.string().uuid().optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:         z.string().optional(),
});
export type WorkOrderBody = z.infer<typeof workOrderBody>;

export const completeWorkOrderBody = z.object({
  completedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  costMinor:     z.number().int().nonnegative().default(0),
  currency:      z.string().length(3).default("INR"),
  notes:         z.string().optional(),
});
export type CompleteWorkOrderBody = z.infer<typeof completeWorkOrderBody>;

export const idParam    = z.object({ id: z.string().uuid() });
export const assetParam = z.object({ id: z.string().uuid() });
