import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";

export async function publishProposalCreate(ctx: RequestContext, payload: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  await queue.publish(COMMANDS.proposalCreate, {
    messageId: randomUUID(),
    type: COMMANDS.proposalCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ...payload },
  });
  return id;
}

export async function publishDaoFinalize(ctx: RequestContext, workId: string): Promise<void> {
  await queue.publish(COMMANDS.proposalDaoFinalize, {
    messageId: randomUUID(),
    type: COMMANDS.proposalDaoFinalize,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { workId },
  });
}

export async function publishSplit(ctx: RequestContext, payload: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  await queue.publish(COMMANDS.proposalSplit, {
    messageId: randomUUID(),
    type: COMMANDS.proposalSplit,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ...payload },
  });
  return id;
}

export async function publishMapCoa(ctx: RequestContext, payload: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  await queue.publish(COMMANDS.proposalMapCoa, {
    messageId: randomUUID(),
    type: COMMANDS.proposalMapCoa,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ...payload },
  });
  return id;
}

export async function publishMapOffice(ctx: RequestContext, payload: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  await queue.publish(COMMANDS.proposalMapOffice, {
    messageId: randomUUID(),
    type: COMMANDS.proposalMapOffice,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ...payload },
  });
  return id;
}
