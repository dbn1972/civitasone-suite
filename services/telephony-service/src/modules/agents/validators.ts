/** zod validators for the agents module. */
import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";
import { AGENT_STATUSES } from "./schema.js";

export const upsertAgentBody = z.object({
  userId: z.string().uuid(),
  displayName: z.string().min(1).max(160),
  queueId: z.string().uuid().optional(),
  status: z.enum(AGENT_STATUSES).default("offline"),
  extension: z.string().max(16).regex(/^[0-9]+$/, "extension must be digits").optional(),
});
export type UpsertAgentBody = z.infer<typeof upsertAgentBody>;

export const setAgentStatusBody = z.object({
  status: z.enum(AGENT_STATUSES),
  expectedVersion: z.coerce.number().int().min(1).optional(),
});
export type SetAgentStatusBody = z.infer<typeof setAgentStatusBody>;

export const idParam = z.object({ id: z.string().uuid() });

export const agentViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string(),
  queueId: z.string().uuid().nullable(),
  status: z.enum(AGENT_STATUSES),
  extension: z.string().nullable(),
  version: z.number().int(),
});

export const agentsListSchema = paginatedSchema(agentViewSchema);

export const upsertAgentPayload = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string().min(1).max(160),
  queueId: z.string().uuid().nullable(),
  status: z.enum(AGENT_STATUSES),
  extension: z.string().nullable(),
});
export type UpsertAgentPayload = z.infer<typeof upsertAgentPayload>;
