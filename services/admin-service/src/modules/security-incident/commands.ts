import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface CreateIncidentInput {
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  description?: string;
  affectedAssets: string[];
  affectedTenants: string[];
  isBreach: boolean;
  affectedDataPrincipals: number;
}

export async function createIncident(ctx: RequestContext, body: CreateIncidentInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.securityIncidentCreate, {
    messageId: id,
    type: COMMANDS.securityIncidentCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function transitionIncident(
  ctx: RequestContext,
  id: string,
  body: {
    toStatus: "triaged" | "contained" | "resolved";
    note?: string;
    rootCause?: string;
    resolution?: string;
  },
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.securityIncidentTransition, {
    messageId,
    type: COMMANDS.securityIncidentTransition,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function closeIncident(
  ctx: RequestContext,
  id: string,
  body: { note?: string },
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.securityIncidentClose, {
    messageId,
    type: COMMANDS.securityIncidentClose,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, note: body.note },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createBreachNotification(
  ctx: RequestContext,
  incidentId: string,
  body: { authority: "data_protection_board" | "data_principals"; affectedCount: number },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.securityBreachNotificationCreate, {
    messageId: id,
    type: COMMANDS.securityBreachNotificationCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, incidentId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitBreachNotification(
  ctx: RequestContext,
  incidentId: string,
  nid: string,
  body: { reference: string },
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.securityBreachNotificationSubmit, {
    messageId,
    type: COMMANDS.securityBreachNotificationSubmit,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: nid, incidentId, tenantId: ctx.tenantId, reference: body.reference },
  });
  return { id: nid, status: "accepted", correlationId: ctx.correlationId };
}
