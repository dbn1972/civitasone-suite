import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";
import { SERVICE_CHANNELS } from "./domain.js";

export const idParam = z.object({ id: z.string().uuid() });

const requiredDocSchema = z.object({
  docType:   safeText({ max: 64 }),
  label:     safeText({ max: 128 }).optional(),
  mandatory: z.boolean().default(true),
});

export const createDefinitionBody = z.object({
  serviceKey:            safeText({ max: 64 }),
  serviceId:             z.string().uuid().optional(),
  name:                  safeText({ max: 160 }),
  ownerDepartment:       safeText({ max: 160 }).optional(),
  eligibilityRuleSetId:  z.string().uuid().optional(),
  feeScheduleId:         z.string().uuid().optional(),
  issuanceType:          safeText({ max: 48 }).optional(),
  requiredDocuments:     z.array(requiredDocSchema).max(50).default([]),
  slaDays:               z.number().int().min(0).max(3650).optional(),
  channels:              z.array(z.enum(SERVICE_CHANNELS)).max(8).default([]),
  forms:                 z.array(z.unknown()).max(50).default([]),
  outputs:               z.array(z.unknown()).max(50).default([]),
});
export type CreateDefinitionBody = z.infer<typeof createDefinitionBody>;

export const submitDefinitionBody = z.object({
  note: safeText({ max: 500, multiline: true }).optional(),
});

export const serviceKeyQuery = z.object({ serviceKey: safeText({ max: 64 }) });
