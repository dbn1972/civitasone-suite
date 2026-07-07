import { z } from "zod";
import { TEMPLATE_STATUSES, CONDITION_TYPES, CONDITION_OPERATORS } from "./domain.js";

// ── Template CRUD ───────────────────────────────────────────────────────────

export const createTemplateBody = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(5000).default(""),
});

export type CreateTemplateBody = z.infer<typeof createTemplateBody>;

export const updateTemplateBody = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(5000).optional(),
  status: z.enum(TEMPLATE_STATUSES).optional(),
  version: z.number().int().positive(),
});

export type UpdateTemplateBody = z.infer<typeof updateTemplateBody>;

export const templateIdParam = z.object({
  id: z.string().uuid(),
});

export const templateListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(TEMPLATE_STATUSES).optional(),
});

export const deleteTemplateBody = z.object({
  version: z.number().int().positive(),
});

// ── Template Clauses ────────────────────────────────────────────────────────

export const addClauseBody = z.object({
  clauseId: z.string().uuid(),
  rank: z.number().int().min(1).max(1000),
  conditionType: z.enum(CONDITION_TYPES).default("always"),
  conditionField: z.string().max(200).nullable().optional().default(null),
  conditionOperator: z.enum(CONDITION_OPERATORS).nullable().optional().default(null),
  conditionValue: z.string().max(500).nullable().optional().default(null),
});

export type AddClauseBody = z.infer<typeof addClauseBody>;

export const updateClauseBody = z.object({
  rank: z.number().int().min(1).max(1000).optional(),
  conditionType: z.enum(CONDITION_TYPES).optional(),
  conditionField: z.string().max(200).nullable().optional(),
  conditionOperator: z.enum(CONDITION_OPERATORS).nullable().optional(),
  conditionValue: z.string().max(500).nullable().optional(),
});

export type UpdateClauseBody = z.infer<typeof updateClauseBody>;

export const templateClauseParams = z.object({
  id: z.string().uuid(),
  clauseId: z.string().uuid(),
});

// ── Render ──────────────────────────────────────────────────────────────────

export const renderQuery = z.object({
  metadata: z.record(z.unknown()).optional().default({}),
});

export type RenderQuery = z.infer<typeof renderQuery>;
