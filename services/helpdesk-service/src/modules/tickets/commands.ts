import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateTicketBody, AssignTicketBody, TransitionTicketBody } from "./validators.js";
import type { TicketView } from "./schema.js";
import { getInitialStatus, validateTypeFields, isValidTransition, type TicketType } from "./itil-domain.js";
import { verifyAssets } from "../cmdb/asset-client.js";
import { HttpError } from "../../shared/context.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createTicket(ctx: RequestContext, body: CreateTicketBody): Promise<Accepted> {
  const id = randomUUID();

  // ITIL: determine initial status based on ticket type
  let initialStatus = "open";
  if (body.ticketType) {
    // Validate type-specific required fields
    const missingFields = validateTypeFields(body.ticketType, body.typeFields as Record<string, unknown> | undefined);
    if (missingFields.length > 0) {
      throw new HttpError(422, "MISSING_TYPE_FIELDS", `Missing required fields for ${body.ticketType}: ${missingFields.join(", ")}`);
    }
    initialStatus = getInitialStatus(body.ticketType);
  }

  // CMDB: attempt to verify asset linkage (graceful on unavailable)
  let assetVerified = false;
  if (body.assetIds && body.assetIds.length > 0) {
    const results = await verifyAssets(body.assetIds, ctx.tenantId);
    assetVerified = results.every((r) => r.verified);
  }

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
      status: initialStatus,
      ticketType: body.ticketType ?? null,
      typeFields: body.typeFields ?? null,
      assetIds: body.assetIds ?? null,
      assetVerified,
      channel: body.channel ?? null,
      categoryId: body.categoryId ?? null,
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

/**
 * Transition a ticket to a new status. Validates the transition against the
 * ITIL workflow state machine for the ticket's type.
 */
export async function transitionTicket(
  ctx: RequestContext,
  id: string,
  ticketType: TicketType,
  currentStatus: string,
  body: TransitionTicketBody,
): Promise<Accepted> {
  if (!isValidTransition(ticketType, currentStatus, body.status)) {
    throw new HttpError(
      422,
      "INVALID_TRANSITION",
      `Cannot transition ${ticketType} ticket from '${currentStatus}' to '${body.status}'`,
    );
  }

  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  await queue.publish(COMMANDS.transitionTicket, {
    messageId: randomUUID(),
    type: COMMANDS.transitionTicket,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, newStatus: body.status },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
