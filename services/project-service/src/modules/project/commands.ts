import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateProjectBody, CreateTaskBody, UpdateTaskStatusBody, CreateMilestoneBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createProject(ctx: RequestContext, body: CreateProjectBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.projectCreate, {
    messageId: id, type: COMMANDS.projectCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createTask(ctx: RequestContext, projectId: string, body: CreateTaskBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.taskCreate, {
    messageId: id, type: COMMANDS.taskCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, projectId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateTaskStatus(ctx: RequestContext, projectId: string, taskId: string, body: UpdateTaskStatusBody): Promise<Accepted> {
  await queue.publish(COMMANDS.taskStatusUpdate, {
    messageId: randomUUID(), type: COMMANDS.taskStatusUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { taskId, tenantId: ctx.tenantId, projectId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "project", projectId));
  return { id: taskId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createMilestone(ctx: RequestContext, projectId: string, body: CreateMilestoneBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.milestoneCreate, {
    messageId: id, type: COMMANDS.milestoneCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, projectId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeMilestone(ctx: RequestContext, projectId: string, mId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.milestoneComplete, {
    messageId: randomUUID(), type: COMMANDS.milestoneComplete,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { mId, tenantId: ctx.tenantId, projectId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "project", projectId));
  return { id: mId, status: "accepted", correlationId: ctx.correlationId };
}
