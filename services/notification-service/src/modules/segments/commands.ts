import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { SegmentCriteria } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface CreateSegmentPayload {
  name: string;
  description?: string | undefined;
  criteria: SegmentCriteria;
}

export interface UpdateSegmentPayload {
  name?: string | undefined;
  description?: string | undefined;
  criteria?: SegmentCriteria | undefined;
}

export async function createSegment(ctx: RequestContext, payload: CreateSegmentPayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createSegment, {
    messageId: id, type: COMMANDS.createSegment, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateSegment(ctx: RequestContext, id: string, payload: UpdateSegmentPayload): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.updateSegment, {
    messageId, type: COMMANDS.updateSegment, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function resolveSegment(ctx: RequestContext, segmentId: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.resolveSegment, {
    messageId, type: COMMANDS.resolveSegment, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { segmentId, tenantId: ctx.tenantId },
  });
  return { id: segmentId, status: "accepted", correlationId: ctx.correlationId };
}
