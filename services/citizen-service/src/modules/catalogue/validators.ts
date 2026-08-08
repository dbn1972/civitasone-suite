import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";
import { FEE_MODELS, SERVICE_CHANNELS, SERVICE_PATTERNS } from "./domain.js";

export const idParam = z.object({ id: z.string().uuid() });

const requiredDocSchema = z.object({
  docType:   safeText({ max: 64 }),
  label:     safeText({ max: 128 }).optional(),
  labels:    z.record(z.string(), safeText({ max: 128 })).optional(),
  mandatory: z.boolean().default(true),
  formats:   z.array(z.enum(["pdf", "jpg", "png"])).max(5).optional(),
  maxSizeMb: z.number().min(1).max(50).optional(),
  verifiedAtLane: safeText({ max: 64 }).optional(),
});

const statutoryRefSchema = z.object({
  act:     safeText({ max: 160 }),
  section: safeText({ max: 64 }).optional(),
  url:     safeText({ max: 512 }).optional(),
});

const designerFields = {
  servicePattern:       z.enum(SERVICE_PATTERNS).optional(),
  ownerOfficeId:        z.string().uuid().optional(),
  offeringOfficeIds:    z.array(z.string().uuid()).max(50).optional(),
  hoaCode:              safeText({ max: 32 }).optional(),
  feeModel:             z.enum(FEE_MODELS).optional(),
  feeScheduleId:        z.string().uuid().optional(),
  statutoryReferences:  z.array(statutoryRefSchema).max(20).default([]),
  formId:               z.string().uuid().optional(),
  workflowDefinitionId: z.string().uuid().optional(),
};

export const createDefinitionBody = z.object({
  serviceKey:            safeText({ max: 64 }),
  serviceId:             z.string().uuid().optional(),
  name:                  safeText({ max: 160 }),
  ownerDepartment:       safeText({ max: 160 }).optional(),
  eligibilityRuleSetId:  z.string().uuid().optional(),
  issuanceType:          safeText({ max: 48 }).optional(),
  requiredDocuments:     z.array(requiredDocSchema).max(50).default([]),
  slaDays:               z.number().int().min(0).max(3650).optional(),
  channels:              z.array(z.enum(SERVICE_CHANNELS)).max(8).default([]),
  forms:                 z.array(z.unknown()).max(50).default([]),
  outputs:               z.array(z.unknown()).max(50).default([]),
  ...designerFields,
});
export type CreateDefinitionBody = z.infer<typeof createDefinitionBody>;

export const updateDefinitionBody = z.object({
  name:                  safeText({ max: 160 }).optional(),
  serviceKey:            safeText({ max: 64 }).optional(),
  ownerDepartment:       safeText({ max: 160 }).optional(),
  slaDays:               z.number().int().min(0).max(3650).optional(),
  channels:              z.array(z.enum(SERVICE_CHANNELS)).max(8).optional(),
  requiredDocuments:     z.array(requiredDocSchema).max(50).optional(),
  forms:                 z.array(z.unknown()).max(50).optional(),
  outputs:               z.array(z.unknown()).max(50).optional(),
  issuanceType:          safeText({ max: 48 }).optional(),
  eligibilityRuleSetId:  z.string().uuid().optional(),
  ...designerFields,
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });
export type UpdateDefinitionBody = z.infer<typeof updateDefinitionBody>;

export const submitDefinitionBody = z.object({
  note: safeText({ max: 500, multiline: true }).optional(),
});

export const serviceKeyQuery = z.object({ serviceKey: safeText({ max: 64 }) });
