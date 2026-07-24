import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";
import { INTAKE_CHANNELS } from "./intake-domain.js";

export const idParam = z.object({ id: z.string().uuid() });
export const trackingParam = z.object({ trackingNo: safeText({ max: 32 }) });

export const saveDraftBody = z.object({
  citizenId:     z.string().uuid().optional(),
  serviceId:     z.string().uuid(),
  serviceKey:    safeText({ max: 64 }).optional(),
  channel:       z.enum(INTAKE_CHANNELS).default("portal"),
  operatorId:    z.string().uuid().optional(),   // operator-on-behalf-of (assisted/counter)
  formData:      z.record(z.unknown()).default({}),
  documentTypes: z.array(safeText({ max: 64 })).max(50).default([]),
});
export type SaveDraftBody = z.infer<typeof saveDraftBody>;

export const updateDraftBody = z.object({
  formData:      z.record(z.unknown()).optional(),
  documentTypes: z.array(safeText({ max: 64 })).max(50).optional(),
});
export type UpdateDraftBody = z.infer<typeof updateDraftBody>;

export const submitDraftBody = z.object({
  documentTypes: z.array(safeText({ max: 64 })).max(50).optional(),
});
export type SubmitDraftBody = z.infer<typeof submitDraftBody>;
