import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: "accepted"; correlationId: string };

async function publish(
  ctx: RequestContext,
  type: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  const id = (payload.id as string) ?? randomUUID();
  await queue.publish(type, {
    messageId: randomUUID(),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, id },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function addScopeCommand(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(ctx, COMMANDS.scopeAdd, body);
}

export async function recordProgressCommand(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(ctx, COMMANDS.progressRecord, body);
}

export async function uploadPhotoCommand(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(ctx, COMMANDS.photoUpload, body);
}

export async function createIssueCommand(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(ctx, COMMANDS.issueCreate, body);
}

export async function closeIssueCommand(ctx: RequestContext, id: string): Promise<Accepted> {
  return publish(ctx, COMMANDS.issueClose, { id });
}

export async function closeWorkCommand(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(ctx, COMMANDS.workClose, body);
}

export async function physicalCompleteCommand(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  return publish(ctx, COMMANDS.physicalComplete, body);
}
