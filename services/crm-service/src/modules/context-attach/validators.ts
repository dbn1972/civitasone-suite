import { z } from "zod";

export const createRuleBody = z.object({
  name: z.string().min(1).max(200),
  eventType: z.string().min(1).max(64),
  matchField: z.string().min(1).max(64),
  matchTarget: z.enum(["account", "contact", "deal", "case"]),
  targetField: z.string().min(1).max(64),
  action: z.enum(["link_activity", "link_document", "create_task"]),
  active: z.boolean().default(true),
  priority: z.number().int().min(0).default(0),
});

export const updateRuleBody = z.object({
  name: z.string().min(1).max(200).optional(),
  eventType: z.string().min(1).max(64).optional(),
  matchField: z.string().min(1).max(64).optional(),
  matchTarget: z.enum(["account", "contact", "deal", "case"]).optional(),
  targetField: z.string().min(1).max(64).optional(),
  action: z.enum(["link_activity", "link_document", "create_task"]).optional(),
  active: z.boolean().optional(),
  priority: z.number().int().min(0).optional(),
});

export const listRulesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  eventType: z.string().max(64).optional(),
  active: z.coerce.boolean().optional(),
});

export const listAttachmentsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  targetType: z.enum(["account", "contact", "deal", "case"]),
  targetId: z.string().uuid(),
});

export const idParam = z.object({ id: z.string().uuid() });
