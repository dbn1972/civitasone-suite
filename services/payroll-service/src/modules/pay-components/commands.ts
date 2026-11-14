import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { specToJson } from "./api.js";
import type { CreateTemplateBody, NewVersionBody } from "./api.js";
import type { ComponentSpec } from "./model.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function send(ctx: RequestContext, type: string, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(type, {
    messageId, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...payload, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export function createTemplate(ctx: RequestContext, body: CreateTemplateBody): Promise<Accepted> {
  const id = randomUUID();
  return send(ctx, COMMANDS.ctcTemplateCreate, id, { id, ...body });
}
export function createComponent(ctx: RequestContext, structureId: string, spec: ComponentSpec): Promise<Accepted> {
  const id = randomUUID();
  return send(ctx, COMMANDS.payComponentCreate, id, { id, structureId, spec: specToJson(spec) });
}
export function updateComponent(ctx: RequestContext, structureId: string, id: string, spec: ComponentSpec, version?: number): Promise<Accepted> {
  return send(ctx, COMMANDS.payComponentUpdate, id, { id, structureId, spec: specToJson(spec), version: version ?? null });
}
export function setComponentActive(ctx: RequestContext, structureId: string, id: string, isActive: boolean, reason: string): Promise<Accepted> {
  return send(ctx, COMMANDS.payComponentSetActive, id, { id, structureId, isActive, reason });
}
export function reorderComponents(ctx: RequestContext, structureId: string, orderedIds: string[]): Promise<Accepted> {
  return send(ctx, COMMANDS.payComponentReorder, structureId, { structureId, orderedIds });
}
export function lockStructure(ctx: RequestContext, structureId: string): Promise<Accepted> {
  return send(ctx, COMMANDS.payStructureLock, structureId, { structureId });
}
export function newStructureVersion(ctx: RequestContext, sourceId: string, body: NewVersionBody): Promise<Accepted> {
  const id = randomUUID();
  return send(ctx, COMMANDS.payStructureNewVersion, id, { id, sourceId, ...body });
}
