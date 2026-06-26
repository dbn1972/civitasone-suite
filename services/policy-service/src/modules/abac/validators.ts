import { z } from "zod";

// Predicate shapes mirror domain.ts Predicate union.
const predicateSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("equals"), path: z.string().min(1), value: z.unknown() }),
  z.object({ op: z.literal("in"), path: z.string().min(1), values: z.array(z.unknown()).min(1) }),
  z.object({ op: z.literal("exists"), path: z.string().min(1) }),
  z.object({ op: z.literal("owner-match"), subjectPath: z.string().min(1).optional(), resourcePath: z.string().min(1).optional() }),
  z.object({ op: z.literal("tenant-match"), subjectPath: z.string().min(1).optional(), resourcePath: z.string().min(1).optional() }),
]);

export const expressionSchema = z.object({
  effect:       z.enum(["allow", "deny"]),
  action:       z.string().min(1).max(128),
  resourceType: z.string().min(1).max(128),
  predicates:   z.array(predicateSchema).max(64),
});
export type ExpressionBody = z.infer<typeof expressionSchema>;

export const createRuleBody = z.object({
  roleId:     z.string().uuid(),
  expression: expressionSchema,
  enabled:    z.boolean().default(true),
});
export type CreateRuleBody = z.infer<typeof createRuleBody>;

export const updateRuleBody = z.object({
  expression: expressionSchema.optional(),
  enabled:    z.boolean().optional(),
}).refine((b) => b.expression !== undefined || b.enabled !== undefined, { message: "at least one field required" });
export type UpdateRuleBody = z.infer<typeof updateRuleBody>;

export const ruleIdParam = z.object({ id: z.string().uuid() });

// Access-request body for POST /v1/policy/abac/evaluate.
const attrBag = z.record(z.unknown());
export const evaluateBody = z.object({
  subject: z.object({
    id:      z.string().optional(),
    roleIds: z.array(z.string()).default([]),
    attrs:   attrBag.default({}),
  }),
  action: z.string().min(1),
  resource: z.object({
    type:  z.string().min(1),
    attrs: attrBag.default({}),
  }),
  context: attrBag.default({}),
});
export type EvaluateBody = z.infer<typeof evaluateBody>;
