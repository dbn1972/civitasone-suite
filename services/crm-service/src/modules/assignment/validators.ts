/** zod validators for lead assignment & escalation (AS-001..004). */
import { z } from "zod";

export const RULE_TYPES = [
  "territory",
  "round_robin",
  "score_threshold",
  "product",
  "segment",
  "language",
  "capacity",
] as const;

export const ruleType = z.enum(RULE_TYPES);

/**
 * criteria is a per-type jsonb blob. It is validated loosely at the boundary
 * (shape depends on rule_type) and interpreted by the pure engine; the engine
 * skips a rule whose criteria is malformed rather than throwing, so a bad blob
 * degrades to "no match" instead of failing every assignment.
 */
export const criteriaSchema = z.record(z.string(), z.unknown());

export const createAssignmentRuleBody = z.object({
  name: z.string().min(1).max(200),
  ruleType,
  criteria: criteriaSchema.default({}),
  ordinal: z.number().int().min(0).max(10_000).optional(),
  enabled: z.boolean().optional(),
  fallbackOwnerId: z.string().uuid().optional(),
});
export type CreateAssignmentRuleBody = z.infer<typeof createAssignmentRuleBody>;

export const updateAssignmentRuleBody = z.object({
  name: z.string().min(1).max(200).optional(),
  ruleType: ruleType.optional(),
  criteria: criteriaSchema.optional(),
  ordinal: z.number().int().min(0).max(10_000).optional(),
  enabled: z.boolean().optional(),
  fallbackOwnerId: z.string().uuid().nullable().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });
export type UpdateAssignmentRuleBody = z.infer<typeof updateAssignmentRuleBody>;

/** Manual assignment: either pin an owner, or ask the engine to route. */
export const assignLeadBody = z.object({
  ownerId: z.string().uuid().optional(),
  runRules: z.boolean().optional(),
}).refine((b) => b.ownerId !== undefined || b.runRules === true, {
  message: "provide ownerId or runRules:true",
});
export type AssignLeadBody = z.infer<typeof assignLeadBody>;

export const idParam = z.object({ id: z.string().uuid() });

// ── AS-002 assignment targets ────────────────────────────────────────────────

export const createQueueBody = z.object({
  name: z.string().min(1).max(200),
  teamId: z.string().uuid().optional(),
  description: z.string().max(1000).optional(),
  enabled: z.boolean().optional(),
});
export type CreateQueueBody = z.infer<typeof createQueueBody>;

export const createTerritoryBody = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(64),
  region: z.string().max(64).optional(),
  ownerId: z.string().uuid().optional(),
});
export type CreateTerritoryBody = z.infer<typeof createTerritoryBody>;

export const createPartnerBody = z.object({
  name: z.string().min(1).max(200),
  partnerType: z.string().max(64).optional(),
  ownerId: z.string().uuid().optional(),
});
export type CreatePartnerBody = z.infer<typeof createPartnerBody>;

export const createBranchBody = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(64).optional(),
  territoryId: z.string().uuid().optional(),
});
export type CreateBranchBody = z.infer<typeof createBranchBody>;

// ── AS-004 escalation ────────────────────────────────────────────────────────

export const escalationTrigger = z.enum(["unaccepted", "unattended"]);

export const upsertEscalationRuleBody = z.object({
  name: z.string().min(1).max(200),
  trigger: escalationTrigger,
  thresholdMinutes: z.number().int().min(1).max(100_000),
  recipientRole: z.string().max(64).optional(),
  recipientId: z.string().uuid().optional(),
  reassign: z.boolean().optional(),
  reassignOwnerId: z.string().uuid().optional(),
  enabled: z.boolean().optional(),
});
export type UpsertEscalationRuleBody = z.infer<typeof upsertEscalationRuleBody>;
