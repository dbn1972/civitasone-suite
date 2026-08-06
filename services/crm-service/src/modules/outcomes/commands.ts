/**
 * outcomes module — command publishers (G18).
 *
 * Routes call these and return 202; the writes live in consumer.ts. Every messageId is
 * derived from the caller's `x-idempotency-key` via {@link commandId}, scoped by topic +
 * entity so one reused key cannot collapse two unrelated writes into a single command.
 */
import type { RequestContext } from "@civitasone/types";
import { randomUUID } from "node:crypto";
import { queue } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";
import type { CreateReasonCodeBody, RecordOutcomeBody, UpdateReasonCodeBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(
  ctx: RequestContext,
  type: string,
  scope: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await queue.publish(type, {
    messageId: commandId(ctx, `${type}:${scope}`),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
}

export async function createOutcomeReasonCode(
  ctx: RequestContext,
  body: CreateReasonCodeBody,
  versionNumber: number,
): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.createOutcomeReasonCode, `${body.category}:${body.code}:${versionNumber}`, {
    id,
    tenantId: ctx.tenantId,
    code: body.code,
    label: body.label,
    description: body.description ?? null,
    category: body.category,
    appliesTo: body.appliesTo,
    // A tenant can never mint a canonical code — those come from a seed migration only.
    governance: "tenant",
    versionNumber,
    active: body.active,
    ordinal: body.ordinal,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateOutcomeReasonCode(
  ctx: RequestContext,
  id: string,
  body: UpdateReasonCodeBody,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.updateOutcomeReasonCode, id, {
    id,
    tenantId: ctx.tenantId,
    ...(body.label !== undefined ? { label: body.label } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.appliesTo !== undefined ? { appliesTo: body.appliesTo } : {}),
    ...(body.ordinal !== undefined ? { ordinal: body.ordinal } : {}),
    ...(body.active !== undefined ? { active: body.active } : {}),
    version: body.version,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteOutcomeReasonCode(ctx: RequestContext, id: string): Promise<Accepted> {
  await publish(ctx, COMMANDS.deleteOutcomeReasonCode, id, { id, tenantId: ctx.tenantId });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Record an interaction outcome.
 *
 * The command is scoped on the OUTCOME REF, not on a fresh uuid: two clicks of the same
 * capture button carry the same business key, and scoping the messageId that way lets the
 * inbox collapse them before the consumer's duplicate guard has to.
 */
export async function recordInteractionOutcome(
  ctx: RequestContext,
  body: RecordOutcomeBody,
  occurredAt: string,
): Promise<Accepted> {
  const id = randomUUID();
  await publish(
    ctx,
    COMMANDS.recordInteractionOutcome,
    `${body.subjectType}:${body.subjectId}:${body.outcomeRef}`,
    {
      id,
      tenantId: ctx.tenantId,
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      outcomeRef: body.outcomeRef,
      outcomeType: body.outcomeType,
      reasonCodeId: body.reasonCodeId ?? null,
      productId: body.productId ?? null,
      // MONEY stays a decimal STRING on the wire all the way to the consumer.
      amountMinor: body.amountMinor ?? null,
      currency: body.currency ?? null,
      followUpNextActionId: body.followUpNextActionId ?? null,
      occurredAt,
    },
  );
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
