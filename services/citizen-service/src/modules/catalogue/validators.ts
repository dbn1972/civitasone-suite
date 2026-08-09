import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";
import { engineBindingsArraySchema } from "../engine-bindings/validators.js";
import { FEE_MODELS, SERVICE_CHANNELS, SERVICE_PATTERNS } from "./domain.js";
import { APPLICANT_TYPES } from "../applicant-identity/domain.js";

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

const profileBindingSchema = z.object({
  attributeKey:  safeText({ max: 64 }),
  applicantType: z.enum(APPLICANT_TYPES),
  required:      z.boolean().default(true),
});

const laneBindingSchema = z.object({
  key:                          safeText({ max: 64 }),
  name:                         safeText({ max: 120 }),
  optional:                     z.boolean().optional(),
  enabled:                      z.boolean().optional(),
  designationId:                safeText({ max: 128 }).optional(),
  designationLabel:             safeText({ max: 160 }).optional(),
  slaDays:                      z.number().int().min(0).max(3650),
  escalationDesignationId:      safeText({ max: 128 }).optional(),
  escalationDesignationLabel:   safeText({ max: 160 }).optional(),
});

/* ── Phase 3 block config ──────────────────────────────────────────────────
 * These schemas check SHAPE and bounds only. The substantive rules — an
 * override for an office that is not offering the service, a webhook aimed at
 * an internal host, an appealable decision with no appellate authority — live
 * in the publish gates, so the caller gets one authoritative error code from
 * one place rather than two half-overlapping validations that can disagree.
 */

const officeOverrideSchema = z.object({
  officeId:            z.string().uuid(),
  feeFromMinor:        z.number().int().min(0).optional(),
  feeScheduleId:       z.string().uuid().optional(),
  additionalDocuments: z.array(requiredDocSchema).max(20).optional(),
  slaDays:             z.number().int().min(1).max(3650).optional(),
  note:                safeText({ max: 500, multiline: true }).optional(),
});

const webhookSubscriptionSchema = z.object({
  id:          safeText({ max: 64 }),
  // Not safeText: this is a URL, and the publish gate parses it with new URL()
  // and applies the SSRF host check. Sanitising it here would corrupt the value
  // before that check ever runs.
  url:         z.string().url().max(2048),
  events:      z.array(safeText({ max: 64 })).min(1).max(20),
  // Not safeText either — a shared HMAC secret is opaque bytes, not display
  // text; stripping characters from it would silently break signature checks.
  secret:      z.string().min(16).max(256),
  active:      z.boolean(),
  description: safeText({ max: 200 }).optional(),
});

const appealLinkageSchema = z.object({
  appealable:                 z.boolean(),
  filingWindowDays:           z.number().int().min(1).max(3650).optional(),
  appellateDesignationId:     safeText({ max: 128 }).optional(),
  appellateDesignationLabel:  safeText({ max: 160 }).optional(),
  statutoryReference:         safeText({ max: 200 }).optional(),
});

const rtiLinkageSchema = z.object({
  published:            z.boolean(),
  pioDesignationId:     safeText({ max: 128 }).optional(),
  pioDesignationLabel:  safeText({ max: 160 }).optional(),
});

const renewalPolicySchema = z.object({
  renewable:         z.boolean(),
  renewalWindowDays: z.number().int().min(0).max(3650),
  validityMode:      z.enum(["none", "duration", "fixed_date"]),
  validityYears:     z.number().int().min(1).max(99).optional(),
  validityFixedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const designerFields = {
  /** FN-22 — per-office fee/SLA/document variants. */
  officeOverrides:      z.array(officeOverrideSchema).max(200).optional(),
  /** FN-30 — outbound webhook subscriptions. */
  webhookSubscriptions: z.array(webhookSubscriptionSchema).max(20).optional(),
  /** FN-18/FN-32 — BCP 47-ish locale tags this service publishes in. */
  locales:              z.array(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)).max(10).optional(),
  // nullable() so a designer can clear a previously-configured block; the gates
  // treat null ("never configured") differently from {appealable:false}.
  /** FN-27 — appeal path. */
  appealLinkage:        appealLinkageSchema.nullable().optional(),
  /** FN-28 — RTI catalogue publication. */
  rtiLinkage:           rtiLinkageSchema.nullable().optional(),
  /** FN-15 — renewal window and validity. */
  renewalPolicy:        renewalPolicySchema.nullable().optional(),
  servicePattern:       z.enum(SERVICE_PATTERNS).optional(),
  ownerOfficeId:        z.string().uuid().optional(),
  offeringOfficeIds:    z.array(z.string().uuid()).max(50).optional(),
  hoaCode:              safeText({ max: 32 }).optional(),
  feeModel:             z.enum(FEE_MODELS).optional(),
  feeScheduleId:        z.string().uuid().optional(),
  statutoryReferences:  z.array(statutoryRefSchema).max(20).default([]),
  engineBindings:       engineBindingsArraySchema.optional(),
  formId:               z.string().uuid().optional(),
  workflowDefinitionId: z.string().uuid().optional(),
  /** FN-23 — applicant identity configuration (B1 Catalogue & Identity). */
  allowedApplicantTypes: z.array(z.enum(APPLICANT_TYPES)).min(1).max(4).optional(),
  applicantTypeRejectMessage: safeText({ max: 500, multiline: true }).optional(),
  profileAttributeBindings: z.array(profileBindingSchema).max(50).optional(),
  /** FN-25 — per-lane SLA + escalation designations. */
  laneBindings:         z.array(laneBindingSchema).max(20).optional(),
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

/** FN-18 — optional locale to report translation coverage against. */
export const localizationQuery = z.object({
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/).optional(),
}).default({});
