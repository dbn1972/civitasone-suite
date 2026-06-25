import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateTicketBody, AssignTicketBody } from "./validators.js";
import type { TicketView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createTicket(ctx: RequestContext, body: CreateTicketBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: TicketView = {
    id,
    subject: body.subject,
    priority: body.priority ?? "Medium",
    status: "Open",
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);

  await queue.publish(COMMANDS.createTicket, {
    messageId: id,
    type: COMMANDS.createTicket,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      subject: body.subject,
      description: body.description ?? null,
      priority: body.priority ?? "Medium",
      status: "open",
    },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** HD2 — assign a ticket to an agent (command → consumer applies + audits). */
export async function assignTicket(ctx: RequestContext, id: string, body: AssignTicketBody): Promise<Accepted> {
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  await queue.publish(COMMANDS.assignTicket, {
    messageId: randomUUID(),
    type: COMMANDS.assignTicket,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, assigneeId: body.assigneeId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
