/**
 * Agenda module — Zod request validators (route boundary).
 *
 * Every write route parses its body through one of these before publishing a command
 * (route → zod → queue.publish → 202). Shapes mirror the `COMMANDS.agenda*` payload
 * contracts documented in src/topics.ts; `meetingId` is taken from the path param and merged
 * in by the route, so the body schemas below cover the request body only.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
 */
import { z } from "zod";
import { AGENDA_OUTCOME_TYPES, AGENDA_CATEGORIES, CONFIDENTIALITY_LEVELS } from "./domain.js";

const uuid = z.string().uuid();
/** Optimistic-lock version (steering: every mutable entity carries a `version`). */
const version = z.number().int().nonnegative();
const outcomeType = z.enum(AGENDA_OUTCOME_TYPES);
const category = z.enum(AGENDA_CATEGORIES);
const confidentialityLevel = z.enum(CONFIDENTIALITY_LEVELS);
const durationMinutes = z.number().int().positive().max(24 * 60);

/**
 * Submit an agenda item proposal (Req 3.1). `outcomeType` is required; supporting documents and
 * linked previous decisions are optional id lists resolved by the consumer.
 */
export const agendaItemSubmitSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(20_000).optional(),
  outcomeType,
  durationMinutes: durationMinutes.optional(),
  presenterId: uuid.optional(),
  category: category.optional(),
  confidentialityLevel: confidentialityLevel.optional(),
  fileReference: z.string().trim().max(200).optional(),
  supportingDocumentIds: z.array(uuid).max(200).optional(),
  linkedDecisionIds: z.array(uuid).max(200).optional(),
});
export type AgendaItemSubmitInput = z.infer<typeof agendaItemSubmitSchema>;

/** The fields of an agenda item that may be patched (Req 3.1, 3.2). */
export const agendaItemPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(20_000).nullable(),
    outcomeType,
    durationMinutes,
    presenterId: uuid.nullable(),
    category: category.nullable(),
    confidentialityLevel,
    fileReference: z.string().trim().max(200).nullable(),
    status: z.enum(["proposed", "accepted", "deferred"]),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "patch must contain at least one field" });
export type AgendaItemPatch = z.infer<typeof agendaItemPatchSchema>;

/** Update an agenda item; optimistic-locked on `version` (Req 3.1). */
export const agendaItemUpdateSchema = z.object({
  agendaItemId: uuid,
  version,
  patch: agendaItemPatchSchema,
});
export type AgendaItemUpdateInput = z.infer<typeof agendaItemUpdateSchema>;

/** Withdraw an agenda item (Req 3.2); optimistic-locked, optional reason for the audit trail. */
export const agendaItemWithdrawSchema = z.object({
  agendaItemId: uuid,
  version,
  reason: z.string().trim().max(2_000).optional(),
});
export type AgendaItemWithdrawInput = z.infer<typeof agendaItemWithdrawSchema>;

/** A single reorder mapping entry (agenda item → target 1-based sequence). */
export const reorderEntrySchema = z.object({
  agendaItemId: uuid,
  sequence: z.number().int().positive(),
});

/**
 * Reorder the agenda (Req 3.3, 3.4). The payload must cover every item exactly once and the
 * sequences must form a 1..N bijection — structural bijection validity is asserted in domain
 * (`validateReorderBijection`) after this shape check passes.
 */
export const agendaReorderSchema = z.object({
  order: z.array(reorderEntrySchema).min(1).max(500),
});
export type AgendaReorderInput = z.infer<typeof agendaReorderSchema>;

/**
 * Lock or unlock the agenda (Req 3.4). `locked: true` finalises the agenda; `locked: false`
 * is a chairperson-only unlock (role enforced at the route). Optimistic-locked on `version`.
 */
export const agendaLockSchema = z.object({
  version,
  locked: z.boolean(),
});
export type AgendaLockInput = z.infer<typeof agendaLockSchema>;
