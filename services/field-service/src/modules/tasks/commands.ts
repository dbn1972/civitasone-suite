/**
 * tasks/commands.ts — publishes task mutation commands to the queue.
 * No DB access here; the consumer applies the write.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { TaskStatus } from "./domain.js";

export type { Accepted };

export interface CreateTaskInput {
  assigneeId: string | null;
  taskType: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  latitude: string | null;
  longitude: string | null;
  address: string | null;
  dueDate: string | null;
  metadata: Record<string, unknown> | null;
}

export async function createTask(ctx: RequestContext, body: CreateTaskInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.taskCreate, id, { id, ...body });
}

export async function updateTask(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.taskUpdate, id, { id, version: body.version, patch: body.patch });
}

export async function assignTask(
  ctx: RequestContext,
  id: string,
  body: { assigneeId: string; version: number },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.taskAssign, id, { id, assigneeId: body.assigneeId, version: body.version });
}

export async function startTask(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.taskStart, id, { id, version });
}

export async function completeTask(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.taskComplete, id, { id, version });
}

export async function cancelTask(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.taskCancel, id, { id, version });
}

export async function deleteTask(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.taskDelete, id, { id, version });
}
