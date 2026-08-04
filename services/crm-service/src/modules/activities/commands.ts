import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";
import type { CreateActivityBody, UpdateActivityBody } from "./validators.js";
import type { ActivityView } from "./schema.js";

const RESOURCE = "activity";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createActivity(ctx: RequestContext, body: CreateActivityBody): Promise<Accepted> {
  const id = commandId(ctx, COMMANDS.createActivity);
  const createdAt = new Date().toISOString();
  const projected: ActivityView = {
    id,
    tenantId: ctx.tenantId,
    actorName: body.actorName ?? "CRM User",
    text: body.text,
    contactId: body.contactId ?? null,
    dealId: body.dealId ?? null,
    type: body.type ?? "note",
    subject: body.subject ?? body.text.slice(0, 80),
    status: body.status ?? "open",
    dueDate: body.dueDate ?? null,
    remindAt: body.remindAt ?? null,
    location: body.location ?? null,
    completedAt: body.status === "completed" ? createdAt : null,
    createdAt,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.createActivity, {
    messageId: id, type: COMMANDS.createActivity,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

// P1-3: update activity status/completion.
export async function updateActivity(ctx: RequestContext, id: string, body: UpdateActivityBody): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.updateActivity}:${id}`);
  await queue.publish(COMMANDS.updateActivity, {
    messageId: msgId, type: COMMANDS.updateActivity,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
