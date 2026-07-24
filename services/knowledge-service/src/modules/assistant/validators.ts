import { z } from "zod";

export const createFaqBody = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(200_000),
  category: z.string().min(1).max(64).optional(),
  tags: z.array(z.string().min(1).max(64)).max(50).default([]),
  status: z.enum(["draft", "published", "archived"]).default("published"),
});
export type CreateFaqBody = z.infer<typeof createFaqBody>;

export const updateFaqBody = z.object({
  question: z.string().min(1).max(500).optional(),
  answer: z.string().min(1).max(200_000).optional(),
  category: z.string().min(1).max(64).optional(),
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});
export type UpdateFaqBody = z.infer<typeof updateFaqBody>;

const flowStep = z.object({
  title: z.string().min(1).max(200),
  instruction: z.string().min(1).max(2000),
});

export const createFlowBody = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().min(1).max(64).optional(),
  steps: z.array(flowStep).min(1).max(100),
  status: z.enum(["draft", "published", "archived"]).default("published"),
});
export type CreateFlowBody = z.infer<typeof createFlowBody>;

export const updateFlowBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  category: z.string().min(1).max(64).optional(),
  steps: z.array(flowStep).min(1).max(100).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});
export type UpdateFlowBody = z.infer<typeof updateFlowBody>;

export const askBody = z.object({
  question: z.string().min(1).max(1000),
  category: z.string().min(1).max(64).optional(),
});
export type AskBody = z.infer<typeof askBody>;

export const escalateBody = z.object({
  question: z.string().min(1).max(1000),
  detail: z.string().max(4000).optional(),
  interactionId: z.string().uuid().optional(),
  priority: z.enum(["Low", "Medium", "High", "Critical"]).default("Medium"),
});
export type EscalateBody = z.infer<typeof escalateBody>;

export const metricsQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type MetricsQuery = z.infer<typeof metricsQuery>;

export const listFaqQuery = z.object({
  category: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListFaqQuery = z.infer<typeof listFaqQuery>;
