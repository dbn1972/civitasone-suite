/**
 * committee module — command publishing helpers (CQRS write side, Req 2.1–2.7).
 *
 * Routes (task 4.3) call these helpers after zod validation to publish a write
 * intent onto the queue and return `202 Accepted` immediately — routes NEVER write
 * to Postgres directly. Each helper mints the durable identity for the entity it
 * creates (committee id / membership id) so the value is known before the async
 * consumer runs and can be returned to the caller and surfaced in the `Location`
 * header. The matching consumer handlers live in `consumer.ts`.
 *
 * Envelope contract (see @civitasone/queue `CommandEnvelope`): `messageId` doubles
 * as the entity id for creates so a command redelivery is idempotent end-to-end —
 * `markProcessed(tx, messageId)` in the consumer dedupes it and the INSERT reuses
 * the same primary key.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateCommitteeBody,
  UpdateCommitteeBody,
  AddMemberBody,
  UpdateMemberBody,
} from "./validators.js";

/** Standard 202-accepted result returned by every command helper. */
export type Accepted = { id: string; status: "accepted"; correlationId: string };

/** Common envelope scaffolding shared by every published command. */
function envelopeBase(ctx: RequestContext, messageId: string, type: string) {
  return {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
  } as const;
}

// ─── Committee create / update ─────────────────────────────────────────────────

/**
 * Publish `committee.create`. Mints the committee id (also the messageId) so the
 * caller learns the id synchronously; the consumer INSERTs it + emits
 * `committee.created`.
 */
export async function committeeCreate(ctx: RequestContext, body: CreateCommitteeBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.committeeCreate, {
    ...envelopeBase(ctx, id, COMMANDS.committeeCreate),
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Publish `committee.update` with an optimistic-lock `version`. `patch` carries only
 * the changed committee fields (a fresh `quorumRule`, when present, replaces the old
 * one wholesale). The consumer applies it via `versionedUpdate` (409 on conflict).
 */
export async function committeeUpdate(
  ctx: RequestContext,
  committeeId: string,
  version: number,
  patch: UpdateCommitteeBody,
): Promise<Accepted> {
  await queue.publish(COMMANDS.committeeUpdate, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.committeeUpdate),
    payload: { committeeId, version, patch },
  });
  return { id: committeeId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Membership add / update / remove ──────────────────────────────────────────

/**
 * Publish `committee.member_add`. Mints the membership row id (also the messageId)
 * so the caller can reference the membership immediately; the consumer validates
 * there is no duplicate active membership before INSERT + `committee.member_added`.
 */
export async function committeeMemberAdd(
  ctx: RequestContext,
  committeeId: string,
  body: AddMemberBody,
): Promise<Accepted> {
  const membershipId = randomUUID();
  await queue.publish(COMMANDS.committeeMemberAdd, {
    ...envelopeBase(ctx, membershipId, COMMANDS.committeeMemberAdd),
    payload: { membershipId, committeeId, tenantId: ctx.tenantId, ...body },
  });
  return { id: membershipId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Publish `committee.member_update` with an optimistic-lock `version`. `patch` may
 * change role / tenureEnd / votingRight / status; the consumer validates any status
 * transition (domain `assertMembershipTransition`) and re-evaluates tenure events.
 */
export async function committeeMemberUpdate(
  ctx: RequestContext,
  committeeId: string,
  membershipId: string,
  version: number,
  patch: UpdateMemberBody,
): Promise<Accepted> {
  await queue.publish(COMMANDS.committeeMemberUpdate, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.committeeMemberUpdate),
    payload: { committeeId, membershipId, version, patch },
  });
  return { id: membershipId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Publish `committee.member_remove` — a soft status change to `removed` (never a
 * hard delete, per steering). Optimistic-locked via `version`.
 */
export async function committeeMemberRemove(
  ctx: RequestContext,
  committeeId: string,
  membershipId: string,
  version: number,
  reason?: string,
): Promise<Accepted> {
  await queue.publish(COMMANDS.committeeMemberRemove, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.committeeMemberRemove),
    payload: { committeeId, membershipId, version, ...(reason !== undefined ? { reason } : {}) },
  });
  return { id: membershipId, status: "accepted", correlationId: ctx.correlationId };
}
