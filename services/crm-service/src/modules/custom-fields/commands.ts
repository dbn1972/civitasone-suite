import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateCustomFieldBody, UpdateCustomFieldBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };
const RESOURCE = "custom_field";

export async function createCustomField(ctx: RequestContext, body: CreateCustomFieldBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createCustomField, {
    messageId: id,
    type: COMMANDS.createCustomField,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      entityType: body.entityType,
      fieldName: body.fieldName,
      fieldType: body.fieldType,
      validationSchema: body.validationSchema ?? null,
      ordinal: body.ordinal,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateCustomField(
  ctx: RequestContext,
  id: string,
  body: UpdateCustomFieldBody,
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.updateCustomField, {
    messageId,
    type: COMMANDS.updateCustomField,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, updatedBy: ctx.actorId },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteCustomField(ctx: RequestContext, id: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.deleteCustomField, {
    messageId,
    type: COMMANDS.deleteCustomField,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
