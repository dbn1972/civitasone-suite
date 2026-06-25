/** zod validators — applied at the route boundary AND the consume boundary. */
import { z } from "zod";
import { paginatedSchema } from "@civitasone/schemas/common";
import { DISPOSITIONS } from "./transitions.js";

/** E.164-ish phone: optional leading +, 3–20 digits/spaces/dashes. */
const phone = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^\+?[0-9][0-9\- ]{2,22}$/, "must be a valid phone number");

const expectedVersion = z.coerce.number().int().min(1).optional();

export const createCallBody = z.object({
  direction: z.enum(["inbound", "outbound"]).default("inbound"),
  callerNumber: phone.optional(),
  calleeNumber: phone.optional(),
  queueId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  linkedRefType: z.enum(["grievance", "helpdesk_ticket", "citizen_request"]).optional(),
  linkedRefId: z.string().uuid().optional(),
});
export type CreateCallBody = z.infer<typeof createCallBody>;

export const ringCallBody = z.object({
  expectedVersion,
  agentId: z.string().uuid().optional(),
  queueId: z.string().uuid().optional(),
});
export type RingCallBody = z.infer<typeof ringCallBody>;

export const answerCallBody = z.object({
  expectedVersion,
  agentId: z.string().uuid(),
});
export type AnswerCallBody = z.infer<typeof answerCallBody>;

export const completeCallBody = z.object({
  expectedVersion,
  disposition: z.enum(DISPOSITIONS),
  talkSeconds: z.coerce.number().int().min(0).max(86_400).optional(),
});
export type CompleteCallBody = z.infer<typeof completeCallBody>;

export const endCallBody = z.object({ expectedVersion });
export type EndCallBody = z.infer<typeof endCallBody>;

export const assignCallBody = z
  .object({
    expectedVersion,
    queueId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
  })
  .refine((b) => b.queueId !== undefined || b.agentId !== undefined, {
    message: "assign requires queueId and/or agentId",
  });
export type AssignCallBody = z.infer<typeof assignCallBody>;

export const ivrHitBody = z.object({
  menuKey: z.string().min(1).max(64),
  digit: z.string().min(1).max(8).regex(/^[0-9*#]+$/, "DTMF digits only"),
});
export type IvrHitBody = z.infer<typeof ivrHitBody>;

export const linkCallBody = z.object({
  refType: z.enum(["grievance", "helpdesk_ticket", "citizen_request"]),
  refId: z.string().uuid(),
});
export type LinkCallBody = z.infer<typeof linkCallBody>;

export const recordingBody = z.object({
  recordingId: z.string().min(1).max(128),
  recordingUrl: z.string().url().max(512).optional(),
  durationSec: z.coerce.number().int().min(0).max(86_400).optional(),
  format: z.enum(["mp3", "wav", "ogg", "opus"]).optional(),
});
export type RecordingBody = z.infer<typeof recordingBody>;

export const listCallsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["queued", "ringing", "answered", "completed", "missed", "abandoned"]).optional(),
  direction: z.enum(["inbound", "outbound"]).optional(),
  queueId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  // Exact caller-number lookup — matched via the blind index, never decrypted.
  callerNumber: phone.optional(),
});
export type ListCallsQuery = z.infer<typeof listCallsQuery>;

export const idParam = z.object({ id: z.string().uuid() });

export const callSummarySchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(["inbound", "outbound"]),
  callerNumber: z.string().nullable(),
  calleeNumber: z.string().nullable(),
  status: z.enum(["queued", "ringing", "answered", "completed", "missed", "abandoned"]),
  disposition: z.string().nullable(),
  queueId: z.string().uuid().nullable(),
  agentId: z.string().uuid().nullable(),
  linkedRefType: z.string().nullable(),
  linkedRefId: z.string().uuid().nullable(),
  hasRecording: z.boolean(),
  waitSeconds: z.number().int().nullable(),
  talkSeconds: z.number().int().nullable(),
  slaAnswered: z.boolean().nullable(),
  abandoned: z.boolean(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  version: z.number().int(),
});

export const callsListSchema = paginatedSchema(callSummarySchema);

/**
 * Consume-boundary payload validators. The consumer is the only DB writer, so
 * it re-validates the envelope payload before persisting (defence in depth: a
 * malformed/poison message is rejected to the DLQ instead of corrupting state).
 */
export const createCallPayload = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  direction: z.enum(["inbound", "outbound"]),
  callerNumber: z.string().nullable(),
  calleeNumber: z.string().nullable(),
  status: z.enum(["queued", "ringing"]),
  queueId: z.string().uuid().nullable(),
  agentId: z.string().uuid().nullable(),
  linkedRefType: z.string().nullable(),
  linkedRefId: z.string().uuid().nullable(),
});
export type CreateCallPayload = z.infer<typeof createCallPayload>;

export const transitionPayload = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  expectedVersion: z.number().int().min(1).optional(),
  agentId: z.string().uuid().optional(),
  queueId: z.string().uuid().optional(),
  disposition: z.enum(DISPOSITIONS).optional(),
  talkSeconds: z.number().int().min(0).optional(),
});
export type TransitionPayload = z.infer<typeof transitionPayload>;
