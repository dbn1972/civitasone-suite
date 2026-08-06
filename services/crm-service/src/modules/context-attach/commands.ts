/**
 * G22 — Context-attach command publishing helpers.
 *
 * Routes validate and publish commands via the queue; the consumer applies them.
 */
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "@civitasone/types";
import { randomUUID } from "node:crypto";

export function publishCreateRule(ctx: RequestContext, payload: Record<string, unknown>): void {
  queue.publish({
    topic: COMMANDS.createContextAttachRule,
    messageId: randomUUID(),
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload,
  });
}

export function publishUpdateRule(ctx: RequestContext, payload: Record<string, unknown>): void {
  queue.publish({
    topic: COMMANDS.updateContextAttachRule,
    messageId: randomUUID(),
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload,
  });
}

export function publishDeleteRule(ctx: RequestContext, payload: Record<string, unknown>): void {
  queue.publish({
    topic: COMMANDS.deleteContextAttachRule,
    messageId: randomUUID(),
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload,
  });
}
