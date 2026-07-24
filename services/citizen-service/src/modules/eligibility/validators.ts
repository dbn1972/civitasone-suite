import { z } from "zod";
import { safeText } from "../../shared/sanitize.js";
import { ELIGIBILITY_OPS, RULE_EFFECTS } from "./domain.js";

export const idParam = z.object({ id: z.string().uuid() });

const ruleSchema = z.object({
  id:        safeText({ max: 64 }),
  attribute: safeText({ max: 64 }),
  op:        z.enum(ELIGIBILITY_OPS),
  value:     z.unknown().optional(),
  effect:    z.enum(RULE_EFFECTS),
  label:     safeText({ max: 200 }).optional(),
});

export const createRuleSetBody = z.object({
  serviceId: z.string().uuid(),
  name:      safeText({ max: 128 }),
  rules:     z.array(ruleSchema).max(200).default([]),
});
export type CreateRuleSetBody = z.infer<typeof createRuleSetBody>;

/** Maker step: submit a draft for publication. */
export const submitRuleSetBody = z.object({
  note: safeText({ max: 500, multiline: true }).optional(),
});

export const evaluateBody = z.object({
  serviceId:     z.string().uuid().optional(),
  ruleSetId:     z.string().uuid().optional(),
  applicationId: z.string().uuid().optional(),
  subjectRef:    z.string().uuid().optional(),
  subject:       z.record(z.unknown()).default({}),
}).refine((b) => b.serviceId || b.ruleSetId, { message: "serviceId or ruleSetId required" });
export type EvaluateBody = z.infer<typeof evaluateBody>;

export const reviewDecisionBody = z.object({
  decision: z.enum(["eligible", "not_eligible"]),
  note:     safeText({ max: 2000, multiline: true }).optional(),
});
export type ReviewDecisionBody = z.infer<typeof reviewDecisionBody>;
