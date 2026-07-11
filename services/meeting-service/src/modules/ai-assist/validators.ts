/**
 * AI-assist module — Zod request schemas (validation at the route boundary).
 *
 * Every AI endpoint parses its body through one of these before anything is published or any
 * provider is invoked (steering: "zod at route boundary, never trust client data past the
 * validator"). `.strict()` rejects unknown keys so a malformed client payload fails fast with a
 * 400 rather than silently ignoring fields.
 *
 * _Requirements: 7.2, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_
 */
import { z } from "zod";
import { MINUTES_TEMPLATE_TYPES } from "../minutes/domain.js";

/** Trigger transcription of a meeting recording (Req 17.x). `recordingRef` is the S3 storage key. */
export const aiTranscribeSchema = z
  .object({
    recordingRef: z.string().min(1).max(1024),
    language: z.string().min(2).max(35).optional(),
  })
  .strict();
export type AiTranscribeInput = z.infer<typeof aiTranscribeSchema>;

/** Generate an AI minutes draft (Req 7.2, 17.x). Optional explicit transcript + template. */
export const aiDraftMinutesSchema = z
  .object({
    transcriptRef: z.string().uuid().optional(),
    templateType: z.enum(MINUTES_TEMPLATE_TYPES).optional(),
  })
  .strict();
export type AiDraftMinutesInput = z.infer<typeof aiDraftMinutesSchema>;

/** Extract candidate action items from a transcript (Req 17.x). */
export const aiExtractActionsSchema = z
  .object({
    transcriptRef: z.string().uuid().optional(),
  })
  .strict();
export type AiExtractActionsInput = z.infer<typeof aiExtractActionsSchema>;

/** Suggest the next meeting's agenda (Req 17.x). Synchronous — returns suggestions directly. */
export const aiSuggestAgendaSchema = z
  .object({
    committeeId: z.string().uuid().optional(),
    lookbackMeetings: z.coerce.number().int().min(1).max(20).default(3),
  })
  .strict();
export type AiSuggestAgendaInput = z.infer<typeof aiSuggestAgendaSchema>;

/** Knowledge-base search (Req 17.1–17.6). Semantic + keyword; access-scoped to the tenant. */
export const knowledgeBaseSearchSchema = z
  .object({
    q: z.string().min(1).max(500),
    committeeId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type KnowledgeBaseSearchInput = z.infer<typeof knowledgeBaseSearchSchema>;
