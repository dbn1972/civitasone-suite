/**
 * decision module — command publishing helpers (CQRS write path).
 *
 * Routes (task 10.3) call these helpers after zod validation to publish a write intent onto
 * the queue and return `202 Accepted`; the decision consumer (see consumer.ts) performs the
 * actual DB write inside a single transaction. This keeps the HTTP layer free of any Postgres
 * access (steering: "routes never write to Postgres directly / do NOT bypass CQRS").
 *
 * Each helper wraps the validated body in the standard CommandEnvelope and publishes to the
 * matching `COMMANDS.decision*` / `COMMANDS.resolution*` / `COMMANDS.dissent*` topic (contract
 * documented in src/topics.ts). Read caches for the affected meeting's decision/resolution
 * listings (and the committee resolution register) are invalidated best-effort so a subsequent
 * read re-loads from the DB rather than serving a pre-write snapshot; the bounded TTL is the
 * backstop.
 *
 * Money note (steering: bigint paise): a decision's `financialImplication` has already been
 * normalised to a canonical base-10 STRING by the validator (`zMoneyMinorString`). The helper
 * forwards that string verbatim across the queue boundary — it is NEVER coerced to a JS
 * `number` — and the consumer rebuilds an exact `bigint` with `parseMinor` before persisting.
 *
 * _Requirements: 11.1, 11.3, 11.4, 11.5, 11.6, 11.8, 12.1, 12.2, 12.3, 22.1, 22.2, 22.3, 22.4, 22.5_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  DecisionRecordInput,
  DecisionUpdateInput,
  ResolutionRecordInput,
  ResolutionSignInput,
  ResolutionCirculationInitInput,
  DissentRecordInput,
} from "./validators.js";

/** Standard queued-write acknowledgement returned to the route (→ HTTP 202). */
export interface DecisionCommandAccepted {
  /** The primary resource id the client can poll (decision id, or resolution id). */
  id: string;
  status: "accepted";
  correlationId: string;
}

const SCHEMA_VERSION = "1.0";

/** Cache resource names (mirrored by the repo layer, task 10.3). */
const DECISION_RESOURCE = "decision";
const RESOLUTION_RESOURCE = "resolution";
const RESOLUTION_REGISTER_RESOURCE = "resolution_register";

/** Best-effort invalidation of a meeting's decision read cache after a write is queued. */
async function invalidateDecisions(tenantId: string, meetingId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, DECISION_RESOURCE, meetingId));
  await cache.invalidateResource(tenantId, DECISION_RESOURCE);
}

/** Best-effort invalidation of a meeting's resolution list read cache after a write is queued. */
async function invalidateResolutions(tenantId: string, meetingId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, RESOLUTION_RESOURCE, meetingId));
  await cache.invalidateResource(tenantId, RESOLUTION_RESOURCE);
}

// ─── Decisions ─────────────────────────────────────────────────────────────────

/**
 * Record a decision on a meeting (Req 11, 22.x). The decision id is minted here and reused as
 * the message id so the write is naturally idempotent and the client gets a stable id to poll.
 * `body.financialImplication` (if present) is a canonical money-minor STRING; it is forwarded
 * unchanged and rebuilt to `bigint` by the consumer.
 */
export async function decisionRecord(
  ctx: RequestContext,
  meetingId: string,
  body: DecisionRecordInput,
): Promise<DecisionCommandAccepted> {
  const decisionId = randomUUID();
  await queue.publish(COMMANDS.decisionRecord, {
    messageId: decisionId,
    type: COMMANDS.decisionRecord,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { decisionId, meetingId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateDecisions(ctx.tenantId, meetingId);
  return { id: decisionId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Update a decision (Req 11.8: status changes + editable metadata). Optimistic-locked on the
 * decision `version`. A `patch.financialImplication` is a money-minor STRING (or null); the
 * consumer rebuilds the `bigint`.
 */
export async function decisionUpdate(
  ctx: RequestContext,
  meetingId: string,
  body: DecisionUpdateInput,
): Promise<DecisionCommandAccepted> {
  await queue.publish(COMMANDS.decisionUpdate, {
    type: COMMANDS.decisionUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { meetingId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateDecisions(ctx.tenantId, meetingId);
  return { id: body.decisionId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Resolutions ─────────────────────────────────────────────────────────────

/**
 * Record a voted resolution on a meeting (Req 11.3, 11.4). The resolution id is minted here and
 * reused as the message id. Vote counts come from the conclude step; the consumer derives the
 * `result` via `computeVoteResult` and assigns the sequential `resolutionNumber` (Req 11.4, P25).
 */
export async function resolutionRecord(
  ctx: RequestContext,
  meetingId: string,
  body: ResolutionRecordInput,
): Promise<DecisionCommandAccepted> {
  const resolutionId = randomUUID();
  await queue.publish(COMMANDS.resolutionRecord, {
    messageId: resolutionId,
    type: COMMANDS.resolutionRecord,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { resolutionId, meetingId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateResolutions(ctx.tenantId, meetingId);
  return { id: resolutionId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Apply the chairperson's DSC to a passed resolution (Req 11.5). `resolutionId` comes from the
 * path; the consumer renders + signs the resolution document and records the signature metadata.
 */
export async function resolutionSign(
  ctx: RequestContext,
  meetingId: string,
  resolutionId: string,
  body: ResolutionSignInput,
): Promise<DecisionCommandAccepted> {
  await queue.publish(COMMANDS.resolutionSign, {
    messageId: randomUUID(),
    type: COMMANDS.resolutionSign,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { resolutionId, meetingId, tenantId: ctx.tenantId, signerId: body.signerId ?? ctx.actorId },
  });
  await invalidateResolutions(ctx.tenantId, meetingId);
  return { id: resolutionId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Initiate a circulation resolution — a decision taken outside a meeting (Req 12.1, 12.2). The
 * resolution id is minted here. The consumer anchors the resolution to the committee's next
 * (or most recent) meeting, distributes the proposal to all members, and tracks responses.
 */
export async function resolutionCirculationInit(
  ctx: RequestContext,
  body: ResolutionCirculationInitInput,
): Promise<DecisionCommandAccepted> {
  const resolutionId = randomUUID();
  await queue.publish(COMMANDS.resolutionCirculationInit, {
    messageId: resolutionId,
    type: COMMANDS.resolutionCirculationInit,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { resolutionId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidateResource(ctx.tenantId, RESOLUTION_RESOURCE);
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOLUTION_REGISTER_RESOURCE, body.committeeId));
  return { id: resolutionId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Dissent ───────────────────────────────────────────────────────────────────

/**
 * Attach a recorded dissent note to a resolution (Req 11.6). `resolutionId` comes from the path.
 * The consumer captures the note against the resolution (as an annexure source for the minutes)
 * without disturbing the vote tally.
 */
export async function dissentRecord(
  ctx: RequestContext,
  meetingId: string,
  resolutionId: string,
  body: DissentRecordInput,
): Promise<DecisionCommandAccepted> {
  await queue.publish(COMMANDS.dissentRecord, {
    messageId: randomUUID(),
    type: COMMANDS.dissentRecord,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { resolutionId, meetingId, tenantId: ctx.tenantId, memberId: body.memberId, note: body.note },
  });
  await invalidateResolutions(ctx.tenantId, meetingId);
  return { id: resolutionId, status: "accepted", correlationId: ctx.correlationId };
}
