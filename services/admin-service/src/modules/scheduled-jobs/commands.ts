/**
 * Scheduled Jobs command handlers (WRITE PATH).
 * Route → validate → publish command to SQS → return 202.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateJobBody, UpdateJobBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function jobCreate(ctx: RequestContext, body: CreateJobBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.scheduledJobCreate, {
    messageId: id,
    type: COMMANDS.scheduledJobCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function jobUpdate(ctx: RequestContext, jobId: string, body: UpdateJobBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.scheduledJobUpdate, {
    messageId: id,
    type: COMMANDS.scheduledJobUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { jobId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function jobDelete(ctx: RequestContext, jobId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.scheduledJobDelete, {
    messageId: id,
    type: COMMANDS.scheduledJobDelete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { jobId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function jobRunNow(ctx: RequestContext, jobId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.scheduledJobRunNow, {
    messageId: id,
    type: COMMANDS.scheduledJobRunNow,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { jobId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function jobPause(ctx: RequestContext, jobId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.scheduledJobPause, {
    messageId: id,
    type: COMMANDS.scheduledJobPause,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { jobId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function jobResume(ctx: RequestContext, jobId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.scheduledJobResume, {
    messageId: id,
    type: COMMANDS.scheduledJobResume,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { jobId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
