/**
 * Command publishers for the segment taxonomy (G5).
 *
 * Routes never write: they validate, publish here and answer 202. Cache invalidation
 * happens both here (so a follow-up read cannot be served a value the caller has just
 * superseded) and in the consumer after the write commits.
 */
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import type { CreateSegmentBody, UpdateSegmentBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = repo.RESOURCE;
const SETTINGS_RESOURCE = repo.SETTINGS_RESOURCE;

async function publishCommand(
  ctx: RequestContext,
  topic: string,
  scope: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const messageId = commandId(ctx, scope);
  await queue.publish(topic, {
    messageId,
    type: topic,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
  return messageId;
}

export async function createSegment(ctx: RequestContext, body: CreateSegmentBody): Promise<Accepted> {
  // Scoped per segmentCode so one reused idempotency key cannot collapse two
  // different segment creations into a single command.
  const id = await publishCommand(ctx, COMMANDS.createSegmentDefinition, `${COMMANDS.createSegmentDefinition}:${body.segmentCode}`, {
    tenantId: ctx.tenantId,
    segmentCode: body.segmentCode,
    displayName: body.displayName,
    description: body.description ?? null,
    governance: body.governance,
    priorityProducts: body.priorityProducts,
    primaryChannels: body.primaryChannels,
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateSegment(
  ctx: RequestContext,
  segmentCode: string,
  body: UpdateSegmentBody,
): Promise<Accepted> {
  const id = await publishCommand(ctx, COMMANDS.updateSegmentDefinition, `${COMMANDS.updateSegmentDefinition}:${segmentCode}`, {
    tenantId: ctx.tenantId,
    segmentCode,
    ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.priorityProducts !== undefined ? { priorityProducts: body.priorityProducts } : {}),
    ...(body.primaryChannels !== undefined ? { primaryChannels: body.primaryChannels } : {}),
    version: body.version,
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function publishSegment(ctx: RequestContext, segmentCode: string): Promise<Accepted> {
  const id = await publishCommand(ctx, COMMANDS.publishSegmentDefinition, `${COMMANDS.publishSegmentDefinition}:${segmentCode}`, {
    tenantId: ctx.tenantId,
    segmentCode,
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deprecateSegment(ctx: RequestContext, segmentCode: string): Promise<Accepted> {
  const id = await publishCommand(ctx, COMMANDS.deprecateSegmentDefinition, `${COMMANDS.deprecateSegmentDefinition}:${segmentCode}`, {
    tenantId: ctx.tenantId,
    segmentCode,
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteSegment(ctx: RequestContext, segmentCode: string): Promise<Accepted> {
  const id = await publishCommand(ctx, COMMANDS.deleteSegmentDefinition, `${COMMANDS.deleteSegmentDefinition}:${segmentCode}`, {
    tenantId: ctx.tenantId,
    segmentCode,
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function setSegmentSettings(ctx: RequestContext, enforceSegmentCatalogue: boolean): Promise<Accepted> {
  const id = await publishCommand(ctx, COMMANDS.setSegmentSettings, COMMANDS.setSegmentSettings, {
    tenantId: ctx.tenantId,
    enforceSegmentCatalogue,
  });
  await cache.invalidateResource(ctx.tenantId, SETTINGS_RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
