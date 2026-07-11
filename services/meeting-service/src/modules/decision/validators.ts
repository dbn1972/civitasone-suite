/**
 * decision module — Zod request validators (route boundary).
 *
 * Every write route parses its body through one of these before publishing a command
 * (route → zod → queue.publish → 202). Shapes mirror the `COMMANDS.decision*` / `COMMANDS.
 * resolution*` / `COMMANDS.dissent*` / `COMMANDS.voteCirculationRespond` payload contracts
 * documented in src/topics.ts. Ids that come from the path (`meetingId`, `resolutionId`) are
 * merged in by the route, so the body schemas below cover the request body only.
 *
 * Money invariant (steering): a decision's `financialImplication` is money in MINOR units
 * (paise) and MUST NOT cross the boundary as a JS `number` that could lose precision above
 * 2^53. It is validated with `@civitasone/schemas` `zMoneyMinorString`, which accepts a JSON
 * number (safe integer) or a base-10 string and normalises to a canonical base-10 STRING; the
 * consumer rebuilds a `bigint` with `parseMinor` before persisting to the BIGINT column.
 *
 * _Requirements: 11.1, 11.3, 11.4, 11.5, 11.6, 11.8, 12.1, 12.3_
 */
import { z } from "zod";
import { zMoneyMinorString } from "@civitasone/schemas";
import {
  DECISION_TYPES,
  DECISION_STATUSES,
  VOTE_TYPES,
  MAJORITY_RULES,
  CIRCULATION_POSITIONS,
} from "./domain.js";

const uuid = z.string().uuid();
/** Optimistic-lock version (steering: every mutable entity carries a `version`). */
const version = z.number().int().nonnegative();
/** RFC-3339 timestamp with offset (matches the meeting-core `isoDateTime` convention). */
const isoDateTime = z.string().datetime({ offset: true });
/** Calendar date `YYYY-YY`-agnostic `YYYY-MM-DD` (matches meeting-core `isoDate`). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected date in YYYY-MM-DD format");
/** ISO-4217 currency code (3 uppercase letters). */
const currency = z.string().regex(/^[A-Z]{3}$/, "expected ISO-4217 3-letter currency code");

const decisionType = z.enum(DECISION_TYPES);
const voteType = z.enum(VOTE_TYPES);
const majorityRule = z.enum(MAJORITY_RULES);
const voteCount = z.number().int().nonnegative();

// ─── Record decision (Req 11.x · COMMANDS.decisionRecord) ──────────────────────

/**
 * Record a decision on a meeting (Req 11, 22.x). `type` drives typed ERP routing downstream.
 * `financialImplication` is paise (see money note above); `currency` defaults to INR at the
 * consumer when omitted. `linkedDecisionIds` seeds decision-register lineage edges.
 */
export const decisionRecordSchema = z.object({
  agendaItemId: uuid.optional(),
  text: z.string().trim().min(1).max(20_000),
  type: decisionType,
  authority: z.string().trim().max(2_000).optional(),
  effectiveDate: isoDate.optional(),
  responsibleOfficer: uuid.optional(),
  deadline: isoDateTime.optional(),
  financialImplication: zMoneyMinorString.optional(),
  currency: currency.optional(),
  linkedDecisionIds: z.array(uuid).max(200).optional(),
});
export type DecisionRecordInput = z.infer<typeof decisionRecordSchema>;

/** The fields of a decision that may be patched (Req 11.8 status changes + editable metadata). */
export const decisionPatchSchema = z
  .object({
    text: z.string().trim().min(1).max(20_000),
    type: decisionType,
    authority: z.string().trim().max(2_000).nullable(),
    effectiveDate: isoDate.nullable(),
    responsibleOfficer: uuid.nullable(),
    deadline: isoDateTime.nullable(),
    financialImplication: zMoneyMinorString.nullable(),
    currency: currency.nullable(),
    status: z.enum(DECISION_STATUSES),
    supersededById: uuid.nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: "patch must contain at least one field" });
export type DecisionPatch = z.infer<typeof decisionPatchSchema>;

/** Update a decision; optimistic-locked on `version` (Req 11.8). */
export const decisionUpdateSchema = z.object({
  decisionId: uuid,
  version,
  patch: decisionPatchSchema,
});
export type DecisionUpdateInput = z.infer<typeof decisionUpdateSchema>;

// ─── Record resolution (Req 11.3, 11.4 · COMMANDS.resolutionRecord) ────────────

/**
 * Record a voted resolution (Req 11.3, 11.4). Vote counts are supplied by the caller (the
 * conclude step) and the consumer derives the `result` via `computeVoteResult` under
 * `majorityRule`, then assigns the sequential `resolutionNumber` (Req 11.4, P25).
 */
export const resolutionRecordSchema = z.object({
  decisionId: uuid.optional(),
  text: z.string().trim().min(1).max(20_000),
  voteType,
  majorityRule: majorityRule.default("simple_majority"),
  votesFor: voteCount.default(0),
  votesAgainst: voteCount.default(0),
  votesAbstain: voteCount.default(0),
  effectiveDate: isoDate.optional(),
});
export type ResolutionRecordInput = z.infer<typeof resolutionRecordSchema>;

// ─── Sign resolution (Req 11.5 · COMMANDS.resolutionSign) ──────────────────────

/** Apply the chairperson's DSC to a passed resolution (Req 11.5). `resolutionId` from path. */
export const resolutionSignSchema = z.object({
  signerId: uuid,
});
export type ResolutionSignInput = z.infer<typeof resolutionSignSchema>;

// ─── Dissent note (Req 11.6 · COMMANDS.dissentRecord) ──────────────────────────

/** Attach a recorded dissent note to a resolution (Req 11.6). `resolutionId` from path. */
export const dissentRecordSchema = z.object({
  memberId: uuid,
  note: z.string().trim().min(1).max(10_000),
});
export type DissentRecordInput = z.infer<typeof dissentRecordSchema>;

// ─── Circulation resolution init (Req 12.1, 12.2 · COMMANDS.resolutionCirculationInit) ──

/**
 * Initiate a circulation resolution — a decision taken outside a meeting (Req 12.1). The
 * proposal is distributed to all committee members with a voting `deadline`. `requiredResponseRate`
 * is an optional per-request override of the committee default (percentage, 0–100); when omitted
 * the domain applies the two-thirds default (Req 12.2).
 */
export const resolutionCirculationInitSchema = z.object({
  committeeId: uuid,
  text: z.string().trim().min(1).max(20_000),
  supportingDocumentIds: z.array(uuid).max(200).optional(),
  deadline: isoDateTime,
  requiredResponseRate: z.number().min(0).max(100).optional(),
  majorityRule: majorityRule.default("simple_majority"),
});
export type ResolutionCirculationInitInput = z.infer<typeof resolutionCirculationInitSchema>;

// ─── Circulation vote (Req 12.3 · COMMANDS.voteCirculationRespond) ─────────────

/**
 * Record a member's response to a circulation resolution (Req 12.3). `resolutionId` from path;
 * `position` ∈ approve | reject | abstain, with an optional comment.
 */
export const circulationVoteSchema = z.object({
  memberId: uuid,
  position: z.enum(CIRCULATION_POSITIONS),
  comment: z.string().trim().max(10_000).optional(),
});
export type CirculationVoteInput = z.infer<typeof circulationVoteSchema>;
