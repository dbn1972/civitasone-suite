/**
 * journeys module — command publishers (G1 + G2).
 *
 * Routes never write to Postgres. Each helper allocates the entity id (derived from the
 * caller's `x-idempotency-key` where one is supplied, so a retried POST collapses to one
 * row), publishes the command and returns the 202 body.
 *
 * Read caches are invalidated here as well as in the consumer: the command may sit on the
 * bus for a moment, and a caller that immediately re-reads should not be served a value the
 * route already knows is about to change.
 */
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";
import { RESOURCES } from "./queries.js";
import type { JourneyStep } from "./schema.js";
import type {
  CreateStageBody,
  UpdateStageBody,
  CreateTemplateBody,
  UpdateTemplateBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function invalidateStage(ctx: RequestContext, id?: string): Promise<void> {
  if (id) await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCES.stage, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCES.stage);
  // A vocabulary change can change whether a template resolves at all.
  await cache.invalidateResource(ctx.tenantId, RESOURCES.resolved);
}

async function invalidateTemplate(ctx: RequestContext, id?: string): Promise<void> {
  if (id) {
    await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCES.template, id));
    await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCES.resolved, id));
  }
  await cache.invalidateResource(ctx.tenantId, RESOURCES.template);
  // A parent's change alters every descendant's resolution, so the whole resource goes.
  await cache.invalidateResource(ctx.tenantId, RESOURCES.resolved);
}

async function publish(ctx: RequestContext, type: string, messageId: string, payload: unknown): Promise<void> {
  await queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
}

// ── Stage vocabulary ───────────────────────────────────────────────────────────

export async function createStageCode(ctx: RequestContext, body: CreateStageBody): Promise<Accepted> {
  const id = commandId(ctx, COMMANDS.createStageCode);
  await publish(ctx, COMMANDS.createStageCode, id, {
    id,
    tenantId: ctx.tenantId,
    stageCode: body.stageCode,
    displayName: body.displayName,
    description: body.description ?? null,
    ordinal: body.ordinal,
    required: body.required,
    // Never taken from the request: a tenant cannot mint canonical vocabulary.
    governance: "tenant",
  });
  await invalidateStage(ctx);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateStageCode(ctx: RequestContext, id: string, body: UpdateStageBody): Promise<Accepted> {
  const messageId = commandId(ctx, `${COMMANDS.updateStageCode}:${id}`);
  await publish(ctx, COMMANDS.updateStageCode, messageId, { id, tenantId: ctx.tenantId, ...body });
  await invalidateStage(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteStageCode(ctx: RequestContext, id: string): Promise<Accepted> {
  const messageId = commandId(ctx, `${COMMANDS.deleteStageCode}:${id}`);
  await publish(ctx, COMMANDS.deleteStageCode, messageId, { id, tenantId: ctx.tenantId });
  await invalidateStage(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

// ── Journey templates ──────────────────────────────────────────────────────────

export async function createJourneyTemplate(
  ctx: RequestContext,
  body: CreateTemplateBody,
  versionNumber: number,
): Promise<Accepted> {
  const id = commandId(ctx, COMMANDS.createJourneyTemplate);
  await publish(ctx, COMMANDS.createJourneyTemplate, id, {
    id,
    tenantId: ctx.tenantId,
    templateKey: body.templateKey,
    name: body.name,
    description: body.description ?? null,
    parentTemplateId: body.parentTemplateId ?? null,
    product: body.product ?? null,
    region: body.region ?? null,
    businessUnit: body.businessUnit ?? null,
    steps: body.steps,
    versionNumber,
    // A template is born a draft. Publication is an explicit, audited transition.
    governance: "tenant",
  });
  await invalidateTemplate(ctx);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateJourneyTemplate(
  ctx: RequestContext,
  id: string,
  body: UpdateTemplateBody,
): Promise<Accepted> {
  const messageId = commandId(ctx, `${COMMANDS.updateJourneyTemplate}:${id}`);
  await publish(ctx, COMMANDS.updateJourneyTemplate, messageId, { id, tenantId: ctx.tenantId, ...body });
  await invalidateTemplate(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteJourneyTemplate(ctx: RequestContext, id: string): Promise<Accepted> {
  const messageId = commandId(ctx, `${COMMANDS.deleteJourneyTemplate}:${id}`);
  await publish(ctx, COMMANDS.deleteJourneyTemplate, messageId, { id, tenantId: ctx.tenantId });
  await invalidateTemplate(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface PublishPublish {
  /** Replacement definition, or null to publish the draft as it stands. */
  steps: JourneyStep[] | null;
  /** Version number the published row will carry. */
  versionNumber: number;
}

/**
 * Publish a template. When `steps` is supplied the returned id is the NEW version row's id
 * — the caller asked for a changed definition and gets back the thing it created, not the
 * row it superseded.
 */
export async function publishJourneyTemplate(
  ctx: RequestContext,
  id: string,
  p: PublishPublish,
): Promise<Accepted> {
  // Derived, not random: a retried POST with the same idempotency key must name the same
  // new row, otherwise the retry's 202 hands the caller an id that will never exist.
  const newTemplateId = p.steps === null
    ? null
    : commandId(ctx, `${COMMANDS.publishJourneyTemplate}:new:${id}:${p.versionNumber}`);
  const messageId = commandId(ctx, `${COMMANDS.publishJourneyTemplate}:${id}:${p.versionNumber}`);
  await publish(ctx, COMMANDS.publishJourneyTemplate, messageId, {
    id,
    tenantId: ctx.tenantId,
    steps: p.steps,
    newTemplateId,
    versionNumber: p.versionNumber,
  });
  await invalidateTemplate(ctx, id);
  return { id: newTemplateId ?? id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deprecateJourneyTemplate(
  ctx: RequestContext,
  id: string,
  reason: string | null,
): Promise<Accepted> {
  const messageId = commandId(ctx, `${COMMANDS.deprecateJourneyTemplate}:${id}`);
  await publish(ctx, COMMANDS.deprecateJourneyTemplate, messageId, { id, tenantId: ctx.tenantId, reason });
  await invalidateTemplate(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
