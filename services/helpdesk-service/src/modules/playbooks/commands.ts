/**
 * G13 Resolution Playbooks — command publishing helpers.
 *
 * Routes never write to Postgres. They validate, publish a command, and return
 * 202; the consumer performs markProcessed → write → outbox event → cache
 * invalidate.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: "accepted"; correlationId: string };

function publish(
  ctx: RequestContext,
  type: string,
  messageId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  return queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...payload },
  });
}

export async function createPlaybook(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  await publish(ctx, COMMANDS.playbookCreate, id, { id, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updatePlaybook(
  ctx: RequestContext,
  id: string,
  body: Record<string, unknown>,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.playbookUpdate, randomUUID(), { id, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function publishPlaybook(
  ctx: RequestContext,
  id: string,
  body: Record<string, unknown>,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.playbookPublish, randomUUID(), {
    id,
    publishedAt: new Date().toISOString(),
    ...body,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deprecatePlaybook(
  ctx: RequestContext,
  id: string,
  body: Record<string, unknown>,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.playbookDeprecate, randomUUID(), { id, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export type RunAccepted = Accepted & { runId: string; playbookId: string; ticketId: string };

export async function startRun(
  ctx: RequestContext,
  payload: { playbookId: string; ticketId: string; [k: string]: unknown },
): Promise<RunAccepted> {
  const runId = randomUUID();
  await publish(ctx, COMMANDS.playbookRunStart, runId, { runId, ...payload });
  return {
    id: runId,
    runId,
    playbookId: payload.playbookId,
    ticketId: payload.ticketId,
    status: "accepted",
    correlationId: ctx.correlationId,
  };
}

export async function completeStep(
  ctx: RequestContext,
  runId: string,
  stepId: string,
  body: Record<string, unknown>,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.playbookStepComplete, randomUUID(), { runId, stepId, ...body });
  return { id: runId, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeRun(
  ctx: RequestContext,
  runId: string,
  body: Record<string, unknown>,
): Promise<Accepted> {
  await publish(ctx, COMMANDS.playbookRunComplete, randomUUID(), { runId, ...body });
  return { id: runId, status: "accepted", correlationId: ctx.correlationId };
}
