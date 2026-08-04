/** AC-003 zod validators — structured communication log. */
import { z } from "zod";

export const COMM_SUBJECT_TYPES = ["contact", "account", "deal"] as const;
export const COMM_DIRECTIONS = ["inbound", "outbound"] as const;
export const COMM_CHANNELS = ["email", "phone", "sms", "whatsapp", "portal", "meeting", "other"] as const;

export const createCommunicationBody = z.object({
  subjectType: z.enum(COMM_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  direction: z.enum(COMM_DIRECTIONS),
  channel: z.enum(COMM_CHANNELS),
  outcome: z.string().max(2000).optional(),
  disposition: z.string().max(2000).optional(),
  summary: z.string().max(4000).optional(),
  occurredAt: z.string().datetime().optional(),
});
export type CreateCommunicationBody = z.infer<typeof createCommunicationBody>;

export const listCommunicationsQuery = z.object({
  subjectType: z.enum(COMM_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListCommunicationsQuery = z.infer<typeof listCommunicationsQuery>;
