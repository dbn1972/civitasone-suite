/** zod validators for the queues module. */
import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";

export const createQueueBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(280).optional(),
  slaAnswerSeconds: z.coerce.number().int().min(1).max(3600).default(20),
});
export type CreateQueueBody = z.infer<typeof createQueueBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const queueViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  slaAnswerSeconds: z.number().int(),
  status: z.string(),
  version: z.number().int(),
});

export const queuesListSchema = paginatedSchema(queueViewSchema);

export const createQueuePayload = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().nullable(),
  slaAnswerSeconds: z.number().int().min(1).max(3600),
});
export type CreateQueuePayload = z.infer<typeof createQueuePayload>;
