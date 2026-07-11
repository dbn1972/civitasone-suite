/**
 * action-item module — command publishing helpers (CQRS write path).
 *
 * Routes (task 11.3) call these helpers after zod validation to publish a write intent onto the
 * queue and return `202 Accepted`; the action-item consumer (see consumer.ts) performs the actual
 * DB write inside a single transaction. This keeps the HTTP layer free of any Postgres access
 * (steering: "routes never write to Postgres directly / do NOT bypass CQRS").
 *
 * Each helper wraps the validated body in the standard CommandEnvelope and publishes to the
 * matching `COMMANDS.actionItem*` topic (contract documented in src/topics.ts). Read caches for
 * the affected item (and the meeting's action-item listing) are invalidated best-effort so a
 * subsequent read re-loads from the DB rather than serving a pre-write snapshot; the bounded TTL
 * is the backstop.
 *
 * Idempotency: for the create-style `assign` helper the freshly minted action-item id doubles as
 * the message id, so a duplicate publish is naturally deduplicated by `markProcessed` (P30).
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 10.1, 10.4_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  ActionItemAssignInput,
  ActionItemUpdateInput,
  ActionItemAcknowledgeInput,
  ActionItemProgressInput,
  ActionItemEvidenceInput,
  ActionItemVerifyInput,
  ActionItemEscalateInput,
} from "./validators.js";

/** Standard queued-write acknowledgement returned to the route (→ HTTP 202). */
export interface ActionItemCommandAccepted {
  /** The action-item id the client can poll. */
  id: string;
  status: "accepted";
  correlationId: string;
}

const SCHEMA_VERSION = "1.0";

/** Cache resource name (mirrored by the repo layer, task 11.3). */
const ACTION_ITEM_RESOURCE = "action_item";

/** Best-effort invalidation of an action item's read caches after a write is queued. */
async function invalidateActionItem(tenantId: string, actionItemId: string, meetingId?: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, ACTION_ITEM_RESOURCE, actionItemId));
  if (meetingId) {
    await cache.invalidate(cache.makeKey(tenantId, ACTION_ITEM_RESOURCE, meetingId));
  }
  await cache.invalidateResource(tenantId, ACTION_ITEM_RESOURCE);
}

// ─── Assign (Req 9.1) ──────────────────────────────────────────────────────────

/**
 * Assign an action item on a meeting (Req 9.1). The action-item id is minted here and reused as
 * the message id so the write is naturally idempotent and the client gets a stable id to poll.
 * `meetingId` comes from the path; the consumer derives the SLA window from the deadline, sets the
 * first escalation trigger, and notifies the assignee (Req 9.3).
 */
export async function actionItemAssign(
  ctx: RequestContext,
  meetingId: string,
  body: ActionItemAssignInput,
): Promise<ActionItemCommandAccepted> {
  const actionItemId = randomUUID();
  await queue.publish(COMMANDS.actionItemAssign, {
    messageId: actionItemId,
    type: COMMANDS.actionItemAssign,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { actionItemId, meetingId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateActionItem(ctx.tenantId, actionItemId, meetingId);
  return { id: actionItemId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Update (Req 9.1) ──────────────────────────────────────────────────────────

/**
 * Update an action item's editable fields (Req 9.1). Optimistic-locked on the item `version`.
 * `actionItemId` comes from the path; the consumer recomputes the SLA / next-escalation window
 * when the deadline changes.
 */
export async function actionItemUpdate(
  ctx: RequestContext,
  actionItemId: string,
  body: ActionItemUpdateInput,
): Promise<ActionItemCommandAccepted> {
  await queue.publish(COMMANDS.actionItemUpdate, {
    messageId: randomUUID(),
    type: COMMANDS.actionItemUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { actionItemId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateActionItem(ctx.tenantId, actionItemId);
  return { id: actionItemId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Acknowledge (Req 9.4) ─────────────────────────────────────────────────────

/**
 * The assignee acknowledges receipt of the action (Req 9.4). Optimistic-locked on `version`.
 * `actionItemId` from path.
 */
export async function actionItemAcknowledge(
  ctx: RequestContext,
  actionItemId: string,
  body: ActionItemAcknowledgeInput,
): Promise<ActionItemCommandAccepted> {
  await queue.publish(COMMANDS.actionItemAcknowledge, {
    messageId: randomUUID(),
    type: COMMANDS.actionItemAcknowledge,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { actionItemId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateActionItem(ctx.tenantId, actionItemId);
  return { id: actionItemId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Progress update (Req 9.x, 10.2) ───────────────────────────────────────────

/**
 * Append a progress note to an action item (Req 9.x, 10.2). The consumer records an append-only
 * `action_progress` row and advances an early-state item to `in_progress`. `actionItemId` from
 * path.
 */
export async function actionItemProgress(
  ctx: RequestContext,
  actionItemId: string,
  body: ActionItemProgressInput,
): Promise<ActionItemCommandAccepted> {
  await queue.publish(COMMANDS.actionItemProgress, {
    messageId: randomUUID(),
    type: COMMANDS.actionItemProgress,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { actionItemId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateActionItem(ctx.tenantId, actionItemId);
  return { id: actionItemId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Evidence submission (Req 9.7) ─────────────────────────────────────────────

/**
 * Submit completion evidence for verification (Req 9.7, P22). The consumer records the evidence,
 * moves the item to `evidence_submitted`, and notifies the verifier (meeting secretary).
 * `actionItemId` from path.
 */
export async function actionItemEvidence(
  ctx: RequestContext,
  actionItemId: string,
  body: ActionItemEvidenceInput,
): Promise<ActionItemCommandAccepted> {
  await queue.publish(COMMANDS.actionItemEvidence, {
    messageId: randomUUID(),
    type: COMMANDS.actionItemEvidence,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { actionItemId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateActionItem(ctx.tenantId, actionItemId);
  return { id: actionItemId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Verify (Req 9.7) ──────────────────────────────────────────────────────────

/**
 * The secretary/chairperson verifies (or rejects) submitted evidence (Req 9.7). `verified: true`
 * requires evidence to be present and transitions the item to `completed`; `false` returns it to
 * the assignee (`in_progress`). `actionItemId` from path.
 */
export async function actionItemVerify(
  ctx: RequestContext,
  actionItemId: string,
  body: ActionItemVerifyInput,
): Promise<ActionItemCommandAccepted> {
  await queue.publish(COMMANDS.actionItemVerify, {
    messageId: randomUUID(),
    type: COMMANDS.actionItemVerify,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { actionItemId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateActionItem(ctx.tenantId, actionItemId);
  return { id: actionItemId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── Escalate (Req 9.5, 9.6) ───────────────────────────────────────────────────

/**
 * Escalate an overdue action item to a higher rung (Req 9.5, 9.6, P20). The consumer enforces
 * monotonicity, advances the escalation level + next trigger, notifies per the chain, and ensures
 * the item surfaces as an ATR on the committee's next meeting (Req 9.8). `actionItemId` from path.
 */
export async function actionItemEscalate(
  ctx: RequestContext,
  actionItemId: string,
  body: ActionItemEscalateInput,
): Promise<ActionItemCommandAccepted> {
  await queue.publish(COMMANDS.actionItemEscalate, {
    messageId: randomUUID(),
    type: COMMANDS.actionItemEscalate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: SCHEMA_VERSION,
    payload: { actionItemId, tenantId: ctx.tenantId, ...body },
  });
  await invalidateActionItem(ctx.tenantId, actionItemId);
  return { id: actionItemId, status: "accepted", correlationId: ctx.correlationId };
}
