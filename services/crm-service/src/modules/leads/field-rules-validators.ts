/** zod validators for the configurable lead field rules (LM-001). */
import { z } from "zod";

/**
 * The fields a tenant may govern. Kept in lockstep with the CHECK constraint in
 * migration 0037 — a name outside this set would be rejected by Postgres after the
 * route had already answered 202, i.e. a silent configuration failure.
 *
 * `country` and `ownerId` are deliberately NOT governable even though contacts carry
 * both: the guided lead form (apps/web .../crm/contacts/new) never collects them and
 * POST /v1/crm/contacts fills them in itself (`country := "IN"`,
 * `ownerId := ctx.actorId` in contacts/commands.ts). Marking either mandatory would
 * therefore fail every UI lead creation with 422 forever — the route rejecting a lead
 * for omitting a value it was about to supply. Make them collectable in the form
 * first, then widen this list and the CHECK together.
 */
export const LEAD_FIELD_NAMES = [
  "name",
  "email",
  "phone",
  "company",
  "designation",
  "city",
  "leadSource",
] as const;

export const leadFieldName = z.enum(LEAD_FIELD_NAMES);
export type LeadFieldName = z.infer<typeof leadFieldName>;

export const upsertLeadFieldRuleBody = z.object({
  fieldName: leadFieldName,
  required: z.boolean(),
  weight: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});
export type UpsertLeadFieldRuleBody = z.infer<typeof upsertLeadFieldRuleBody>;

export const leadFieldNameParam = z.object({ fieldName: leadFieldName });

export const leadFieldRuleViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  fieldName: z.string(),
  required: z.boolean(),
  weight: z.number().int(),
  enabled: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const leadFieldRulesListSchema = z.object({
  data: z.array(leadFieldRuleViewSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  }),
});
