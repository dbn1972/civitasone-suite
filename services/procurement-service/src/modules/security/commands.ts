import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CollectEmdBody, ResolveEmdBody, CollectPbgBody, ResolvePbgBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function collectEmd(ctx: RequestContext, body: CollectEmdBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.emdCollect, {
    messageId: id, type: COMMANDS.emdCollect,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function forfeitEmd(ctx: RequestContext, id: string, body: ResolveEmdBody): Promise<Accepted> {
  await queue.publish(COMMANDS.emdForfeit, {
    messageId: randomUUID(), type: COMMANDS.emdForfeit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason: body.reason ?? null },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "emd", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function refundEmd(ctx: RequestContext, id: string, body: ResolveEmdBody): Promise<Accepted> {
  await queue.publish(COMMANDS.emdRefund, {
    messageId: randomUUID(), type: COMMANDS.emdRefund,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason: body.reason ?? null },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "emd", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function collectPbg(ctx: RequestContext, body: CollectPbgBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.pbgCollect, {
    messageId: id, type: COMMANDS.pbgCollect,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function forfeitPbg(ctx: RequestContext, id: string, body: ResolvePbgBody): Promise<Accepted> {
  await queue.publish(COMMANDS.pbgForfeit, {
    messageId: randomUUID(), type: COMMANDS.pbgForfeit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason: body.reason ?? null },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "pbg", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function releasePbg(ctx: RequestContext, id: string, body: ResolvePbgBody): Promise<Accepted> {
  await queue.publish(COMMANDS.pbgRelease, {
    messageId: randomUUID(), type: COMMANDS.pbgRelease,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason: body.reason ?? null },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "pbg", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
