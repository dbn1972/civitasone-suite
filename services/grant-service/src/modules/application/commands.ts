import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { SubmitApplicationBody, ScoreApplicationBody, ApproveApplicationBody, RejectApplicationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function submitApplication(ctx: RequestContext, schemeId: string, body: SubmitApplicationBody): Promise<Accepted> {
  const id = randomUUID();
  // grantNo is allocated gaplessly inside the consumer transaction (per-tenant, per-FY counter).
  await queue.publish(COMMANDS.applicationSubmit, {
    messageId: id, type: COMMANDS.applicationSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, schemeId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function scoreApplication(ctx: RequestContext, id: string, body: ScoreApplicationBody): Promise<Accepted> {
  await queue.publish(COMMANDS.applicationScore, {
    type: COMMANDS.applicationScore,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "application", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveApplication(ctx: RequestContext, id: string, body: ApproveApplicationBody): Promise<Accepted> {
  await queue.publish(COMMANDS.applicationApprove, {
    type: COMMANDS.applicationApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "application", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function rejectApplication(ctx: RequestContext, id: string, body: RejectApplicationBody): Promise<Accepted> {
  await queue.publish(COMMANDS.applicationReject, {
    type: COMMANDS.applicationReject,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason: body.reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "application", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
