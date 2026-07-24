import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";
import { EXEMPTION_KINDS } from "./domain.js";
import { ELIGIBILITY_OPS } from "../eligibility/domain.js";

export const idParam = z.object({ id: z.string().uuid() });

const exemptionSchema = z.object({
  id:        safeText({ max: 64 }),
  attribute: safeText({ max: 64 }),
  op:        z.enum(ELIGIBILITY_OPS),
  value:     z.unknown().optional(),
  kind:      z.enum(EXEMPTION_KINDS),
  amount:    z.number().min(0).max(1_000_000_000).optional(),
  label:     safeText({ max: 200 }).optional(),
});

export const createScheduleBody = z.object({
  serviceId:  z.string().uuid(),
  name:       safeText({ max: 128 }),
  baseAmount: z.number().min(0).max(1_000_000_000),
  currency:   z.string().length(3).default("INR"),
  exemptions: z.array(exemptionSchema).max(100).default([]),
});
export type CreateScheduleBody = z.infer<typeof createScheduleBody>;

export const computeFeeBody = z.object({
  applicationId: z.string().uuid(),
  serviceId:     z.string().uuid().optional(),
  scheduleId:    z.string().uuid().optional(),
  subject:       z.record(z.unknown()).default({}),
}).refine((b) => b.serviceId || b.scheduleId, { message: "serviceId or scheduleId required" });
export type ComputeFeeBody = z.infer<typeof computeFeeBody>;

export const createIntentBody = z.object({
  applicationId: z.string().uuid(),
  serviceId:     z.string().uuid().optional(),
  scheduleId:    z.string().uuid().optional(),
  citizenId:     z.string().uuid().optional(),
  subject:       z.record(z.unknown()).default({}),
}).refine((b) => b.serviceId || b.scheduleId, { message: "serviceId or scheduleId required" });
export type CreateIntentBody = z.infer<typeof createIntentBody>;

export const recordOfflineBody = z.object({
  applicationId: z.string().uuid(),
  serviceId:     z.string().uuid().optional(),
  scheduleId:    z.string().uuid().optional(),
  citizenId:     z.string().uuid().optional(),
  subject:       z.record(z.unknown()).default({}),
  reference:     safeText({ max: 128 }).optional(),
}).refine((b) => b.serviceId || b.scheduleId, { message: "serviceId or scheduleId required" });
export type RecordOfflineBody = z.infer<typeof recordOfflineBody>;

export const refundRequestBody = z.object({
  amount: z.number().positive().max(1_000_000_000),
  reason: safeText({ max: 500, multiline: true }).optional(),
});
export type RefundRequestBody = z.infer<typeof refundRequestBody>;

export const refundDecisionBody = z.object({
  decision: z.enum(["approve", "reject"]),
  note:     safeText({ max: 500, multiline: true }).optional(),
});
export type RefundDecisionBody = z.infer<typeof refundDecisionBody>;
