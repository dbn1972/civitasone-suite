/**
 * Voting module — command publishing helpers (CQRS write side, Req 11.1–11.5, 12.3, 12.6).
 *
 * Routes (task 13.3) call these helpers after zod validation to publish a write intent onto
 * the queue and return `202 Accepted` immediately — routes NEVER write to Postgres directly
 * (steering: "routes never write to Postgres directly"). The matching consumer handlers live
 * in `consumer.ts`.
 *
 * Ownership boundary (steering L2): a vote opens a resolution, and the `meeting.resolutions`
 * table is owned by the decision module. The command that OPENS a resolution for voting
 * (`voteInitiate`) mints the resolution id here so the caller learns it synchronously (returned
 * in the 202 body + `Location` header) and so a redelivery is idempotent end-to-end — the
 * consumer's `markProcessed(tx, messageId)` dedupes it and the INSERT reuses the same id.
 *
 * Envelope contract (see @civitasone/queue `PublishInput`/`CommandEnvelope`): each helper wraps
 * the validated body in the standard envelope and publishes to the matching `COMMANDS.vote*`
 * topic (payload contract documented in src/topics.ts).
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 12.3, 12.6_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { VoteInitiateInput, VoteCastInput, VoteConcludeInput } from "./validators.js";

/** Standard 202-accepted result returned by every command helper. */
export interface VoteCommandAccepted {
  /** The primary resource id the client can poll (resolution id). */
  id: string;
  status: "accepted";
  correlationId: string;
}

const SCHEMA_VERSION = "1.0";

/** Common envelope scaffolding shared by every published command. */
function envelopeBase(ctx: RequestContext, messageId: string, type: string) {
  return {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
  } as const;
}

// ─── Initiate vote (Req 11.1, 11.2, 11.4) ───────────────────────────────────────

/**
 * Publish `meeting.vote.initiate` (Req 11.2). Mints the resolution id (also the message id) so
 * the resolution row the consumer opens for voting has a stable, caller-known identity. The
 * consumer re-verifies quorum is still met (`assertQuorumAtVoteTime`) before opening the
 * resolution and rejects initiation if quorum has been lost.
 */
export async function voteInitiate(
  ctx: RequestContext,
  meetingId: string,
  body: VoteInitiateInput,
): Promise<VoteCommandAccepted> {
  const resolutionId = randomUUID();
  await queue.publish(COMMANDS.voteInitiate, {
    ...envelopeBase(ctx, resolutionId, COMMANDS.voteInitiate),
    payload: { resolutionId, meetingId, tenantId: ctx.tenantId, ...body },
  });
  return { id: resolutionId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Cast vote (Req 11.3) ───────────────────────────────────────────────────────

/**
 * Publish `meeting.vote.cast` (Req 11.3). The voting member is the authenticated actor
 * (`ctx.actorId`), so it is derived here rather than trusted from the body. The consumer
 * pre-checks the one-vote-per-member rule (`assertNoDuplicateVote`, backed by the DB
 * `UNIQUE(resolution_id, member_id)` constraint, P17) before recording the ballot.
 */
export async function voteCast(
  ctx: RequestContext,
  meetingId: string,
  body: VoteCastInput,
): Promise<VoteCommandAccepted> {
  await queue.publish(COMMANDS.voteCast, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.voteCast),
    payload: {
      meetingId,
      resolutionId: body.resolutionId,
      memberId: ctx.actorId,
      position: body.position,
      tenantId: ctx.tenantId,
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    },
  });
  return { id: body.resolutionId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Conclude vote (Req 11.4, 11.5) ─────────────────────────────────────────────

/**
 * Publish `meeting.vote.conclude` (Req 11.4). The consumer tallies the recorded positions,
 * computes the result per the resolution's configured majority rule (`computeVoteResult`),
 * assigns the sequential resolution number, and — when the resolution passes — anchors the
 * content integrity hash used for DSC/QR verification (Req 11.5).
 */
export async function voteConclude(
  ctx: RequestContext,
  meetingId: string,
  resolutionId: string,
  body: VoteConcludeInput,
): Promise<VoteCommandAccepted> {
  await queue.publish(COMMANDS.voteConclude, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.voteConclude),
    payload: {
      meetingId,
      resolutionId,
      tenantId: ctx.tenantId,
      ...(body.effectiveDate !== undefined ? { effectiveDate: body.effectiveDate } : {}),
    },
  });
  return { id: resolutionId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Circulation respond (Req 12.3) ──────────────────────────────────────────────

/**
 * Publish `meeting.vote.circulation_respond` (Req 12.3). Records one committee member's
 * asynchronous position (approve / reject / abstain, with an optional comment) on a circulation
 * resolution. The responding member is the authenticated actor (`ctx.actorId`). The consumer
 * records the vote and, once every member has responded or the deadline has passed (Req 12.4),
 * computes and records the outcome.
 */
export async function voteCirculationRespond(
  ctx: RequestContext,
  resolutionId: string,
  body: { position: "approve" | "reject" | "abstain"; comment?: string },
): Promise<VoteCommandAccepted> {
  await queue.publish(COMMANDS.voteCirculationRespond, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.voteCirculationRespond),
    payload: {
      resolutionId,
      memberId: ctx.actorId,
      position: body.position,
      tenantId: ctx.tenantId,
      ...(body.comment !== undefined ? { comment: body.comment } : {}),
    },
  });
  return { id: resolutionId, status: "accepted", correlationId: ctx.correlationId };
}
