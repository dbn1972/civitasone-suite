/**
 * action-item module — Zod request validators (route boundary).
 *
 * Every write route parses its body through one of these before publishing a command
 * (route → zod → queue.publish → 202). Shapes mirror the `COMMANDS.actionItem*` payload
 * contracts documented in src/topics.ts. Ids that come from the path (`meetingId`,
 * `actionItemId`) are merged in by the route, so the body schemas below cover the request body
 * only.
 *
 * Enum vocabularies (priority, status) are imported from domain.ts so the validator and the pure
 * domain logic cannot drift on the value sets.
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.7, 10.6_
 */
import { z } from "zod";
import { ACTION_PRIORITIES } from "./domain.js";

const uuid = z.string().uuid();
/** Optimistic-lock version (steering: every mutable entity carries a `version`). */
const version = z.number().int().nonnegative();
/** RFC-3339 timestamp with offset (matches the meeting-core `isoDateTime` convention). */
const isoDateTime = z.string().datetime({ offset: true });
/** Action priority (Req 9.1). */
const priority = z.enum(ACTION_PRIORITIES);
/** Completion percentage 0–100 (Req 9.x progress updates). */
const percentage = z.number().int().min(0).max(100);

// ─── Assign action item (Req 9.1 · COMMANDS.actionItemAssign) ──────────────────

/**
 * Assign an action item on a meeting (Req 9.1). `meetingId` comes from the path. `deadline` is
 * required (the SLA window is derived from it — see domain `computeSlaHours`); `slaHours` is an
 * optional explicit override. `expectedEvidence` records what completion proof is expected.
 * `decisionId` / `agendaItemId` link the action to its originating decision / agenda item.
 */
export const actionItemAssignSchema = z.object({
  decisionId: uuid.optional(),
  agendaItemId: uuid.optional(),
  description: z.string().trim().min(1).max(20_000),
  assigneeId: uuid,
  deadline: isoDateTime,
  priority: priority.default("medium"),
  slaHours: z.number().int().positive().max(8_760).optional(),
  expectedEvidence: z.string().trim().max(4_000).optional(),
});
export type ActionItemAssignInput = z.infer<typeof actionItemAssignSchema>;

// ─── Update action item (Req 9.1 · COMMANDS.actionItemUpdate) ──────────────────

/** The editable fields of an action item (Req 9.1). */
export const actionItemPatchSchema = z
  .object({
    description: z.string().trim().min(1).max(20_000),
    assigneeId: uuid,
    deadline: isoDateTime,
    priority,
    slaHours: z.number().int().positive().max(8_760).nullable(),
    expectedEvidence: z.string().trim().max(4_000).nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "patch must contain at least one field" });
export type ActionItemPatch = z.infer<typeof actionItemPatchSchema>;

/** Update an action item; optimistic-locked on `version` (Req 9.1). */
export const actionItemUpdateSchema = z.object({
  version,
  patch: actionItemPatchSchema,
});
export type ActionItemUpdateInput = z.infer<typeof actionItemUpdateSchema>;

// ─── Acknowledge assignment (Req 9.4 · COMMANDS.actionItemAcknowledge) ─────────

/** The assignee acknowledges receipt of the action (Req 9.4). `actionItemId` from path. */
export const actionItemAcknowledgeSchema = z.object({
  version,
});
export type ActionItemAcknowledgeInput = z.infer<typeof actionItemAcknowledgeSchema>;

// ─── Progress update (Req 9.x · COMMANDS.actionItemProgress) ───────────────────

/**
 * Submit a progress update on an action item (Req 9.x, 10.2). Appends a note with the current
 * completion `percentage`. `actionItemId` from path.
 */
export const actionItemProgressSchema = z.object({
  updateText: z.string().trim().min(1).max(10_000),
  percentage: percentage.default(0),
});
export type ActionItemProgressInput = z.infer<typeof actionItemProgressSchema>;

// ─── Evidence submission (Req 9.7 · COMMANDS.actionItemEvidence) ───────────────

/**
 * Submit completion evidence for verification (Req 9.7, P22). At least one of `evidenceUrl` /
 * `evidenceNote` must be present — verification requires evidence. `actionItemId` from path.
 */
export const actionItemEvidenceSchema = z
  .object({
    evidenceUrl: z.string().url().max(2_000).optional(),
    evidenceNote: z.string().trim().min(1).max(10_000).optional(),
  })
  .refine((body) => Boolean(body.evidenceUrl) || Boolean(body.evidenceNote), {
    message: "at least one of evidenceUrl or evidenceNote is required",
  });
export type ActionItemEvidenceInput = z.infer<typeof actionItemEvidenceSchema>;

// ─── Verify completion (Req 9.7 · COMMANDS.actionItemVerify) ───────────────────

/**
 * The secretary/chairperson verifies (or rejects) submitted evidence (Req 9.7). `verified: true`
 * transitions the item to `verified`; `false` returns it to the assignee with an optional `note`.
 * `actionItemId` from path.
 */
export const actionItemVerifySchema = z.object({
  verifierId: uuid,
  verified: z.boolean(),
  note: z.string().trim().max(10_000).optional(),
});
export type ActionItemVerifyInput = z.infer<typeof actionItemVerifySchema>;

// ─── Escalate (Req 9.5, 9.6 · COMMANDS.actionItemEscalate) ─────────────────────

/**
 * Escalate an overdue action item to a higher rung (Req 9.5, 9.6, P20). Normally published by
 * the escalation worker (task 20.1) on an SLA breach, but exposed as a command helper so an
 * operator can force an escalation. `toLevel` is the target rung (1→supervisor, 2→department
 * head, 3→chairperson); the consumer enforces monotonicity (`assertEscalationMonotonic`).
 * `actionItemId` from path.
 */
export const actionItemEscalateSchema = z.object({
  toLevel: z.number().int().min(1).max(3),
});
export type ActionItemEscalateInput = z.infer<typeof actionItemEscalateSchema>;
