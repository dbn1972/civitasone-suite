import { z } from "zod";

export const scriptStatus = z.enum(["draft", "published", "deprecated"]);

export const createAgentScriptBody = z.object({
  productCode: z.string().min(1).max(120),
  language: z.string().min(2).max(10),
  scriptKey: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  versionNumber: z.number().int().min(1).default(1),
  tags: z.array(z.string().min(1).max(100)).max(20).default([]),
});
export type CreateAgentScriptBody = z.infer<typeof createAgentScriptBody>;

export const updateAgentScriptBody = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).optional(),
  tags: z.array(z.string().min(1).max(100)).max(20).optional(),
  version: z.number().int().min(1),
}).refine((b) => b.title !== undefined || b.body !== undefined || b.tags !== undefined, {
  message: "at least one field (title, body, tags) required",
});
export type UpdateAgentScriptBody = z.infer<typeof updateAgentScriptBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const agentScriptListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  product_code: z.string().min(1).max(120).optional(),
  language: z.string().min(2).max(10).optional(),
});
