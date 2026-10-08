import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateDltTemplateBody, UpdateDltTemplateBody } from "./validators.js";

/**
 * GAP2-NOTIFICATIONS-DLT-10: DLT (TRAI) template registration is a regulated
 * mutation. Per CLAUDE.md CQRS it must NOT write to Postgres from the route;
 * it validates, publishes a command to the bus, and returns 202. The consumer
 * applies the write via the transactional outbox and emits the audit event in
 * the same transaction. Mirrors the webhook/digest/scheduling modules.
 */
export type Accepted = { id: string; status: string; correlationId: string };

export async function createDltTemplate(ctx: RequestContext, body: CreateDltTemplateBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createDltTemplate, {
    messageId: id,
    type: COMMANDS.createDltTemplate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateDltTemplate(ctx: RequestContext, id: string, body: UpdateDltTemplateBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.updateDltTemplate, {
    messageId,
    type: COMMANDS.updateDltTemplate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteDltTemplate(ctx: RequestContext, id: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.deleteDltTemplate, {
    messageId,
    type: COMMANDS.deleteDltTemplate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
