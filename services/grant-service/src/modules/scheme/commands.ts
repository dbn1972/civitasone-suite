import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateSchemeBody, CreateCriterionBody, UpdateSchemeBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createScheme(ctx: RequestContext, body: CreateSchemeBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.schemeCreate, {
    messageId: id, type: COMMANDS.schemeCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateScheme(ctx: RequestContext, id: string, body: UpdateSchemeBody): Promise<Accepted> {
  await queue.publish(COMMANDS.schemeUpdate, {
    type: COMMANDS.schemeUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, updatedBy: ctx.actorId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function closeScheme(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.schemeClose, {
    type: COMMANDS.schemeClose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, closedBy: ctx.actorId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createCriterion(ctx: RequestContext, schemeId: string, body: CreateCriterionBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.eligibilityCreate, {
    messageId: id, type: COMMANDS.eligibilityCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, schemeId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
