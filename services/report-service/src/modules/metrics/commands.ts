/**
 * metrics/commands.ts — publishes metric-definition commands. NO DB writes here.
 * Strict CQRS: routes validate, this file publishes, consumer.ts performs the write.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { MetricDefinitionView } from "./schema.js";

export interface Accepted {
  id: string;
  status: "accepted";
  correlationId: string;
}

/** Projection published on create/version — the row the consumer will insert. */
export type MetricDefinitionProjection = Omit<
  MetricDefinitionView,
  "createdAt" | "updatedAt" | "publishedAt" | "deprecatedAt"
>;

async function publish(
  ctx: RequestContext,
  topic: string,
  messageId: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(topic, {
    messageId,
    type: topic,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createMetricDefinition(
  ctx: RequestContext,
  projection: MetricDefinitionProjection,
): Promise<Accepted> {
  return publish(ctx, COMMANDS.createMetricDefinition, projection.id, { ...projection });
}

export async function updateMetricDefinition(
  ctx: RequestContext,
  id: string,
  version: number,
  patch: Record<string, unknown>,
): Promise<Accepted> {
  const messageId = randomUUID();
  const accepted = await publish(ctx, COMMANDS.updateMetricDefinition, messageId, {
    id,
    version,
    patch,
  });
  // The caller cares about the definition id, not the command id.
  return { ...accepted, id };
}

export async function publishMetricDefinition(
  ctx: RequestContext,
  id: string,
  version: number,
  metricKey: string,
): Promise<Accepted> {
  const messageId = randomUUID();
  const accepted = await publish(ctx, COMMANDS.publishMetricDefinition, messageId, {
    id,
    version,
    metricKey,
  });
  return { ...accepted, id };
}

export async function deprecateMetricDefinition(
  ctx: RequestContext,
  id: string,
  version: number,
  metricKey: string,
): Promise<Accepted> {
  const messageId = randomUUID();
  const accepted = await publish(ctx, COMMANDS.deprecateMetricDefinition, messageId, {
    id,
    version,
    metricKey,
  });
  return { ...accepted, id };
}

export async function createNextVersion(
  ctx: RequestContext,
  sourceId: string,
  projection: MetricDefinitionProjection,
): Promise<Accepted> {
  return publish(ctx, COMMANDS.versionMetricDefinition, projection.id, {
    ...projection,
    sourceId,
  });
}
