import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateRoleBody, UpdateRoleBody, AddPermissionBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createRole(ctx: RequestContext, body: CreateRoleBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createRole, {
    messageId: id, type: COMMANDS.createRole, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, name: body.name, description: body.description ?? null },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateRole(ctx: RequestContext, id: string, body: UpdateRoleBody): Promise<Accepted> {
  await queue.publish(COMMANDS.updateRole, {
    type: COMMANDS.updateRole, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function addPermission(ctx: RequestContext, roleId: string, body: AddPermissionBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.addPermission, {
    messageId: id, type: COMMANDS.addPermission, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, roleId, tenantId: ctx.tenantId, resource: body.resource, action: body.action, effect: body.effect },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
