import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, TASK_RESOURCE } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as instanceRepo from "../instances/repo.js";
import type { TaskView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function completeTask(
  ctx: RequestContext,
  taskId: string,
  decision: "approve" | "reject" = "approve",
): Promise<Accepted> {
  const existing = await repo.findById(taskId, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "task not found");
  if (existing.status === "completed") throw new HttpError(409, "CONFLICT", "task already completed");

  // Segregation of duties: prevent self-approval.
  // super_admin is exempt (break-glass) but all other roles are blocked.
  if (!ctx.roles.includes("super_admin")) {
    const instance = await instanceRepo.findByIdFull(existing.instanceId, ctx.tenantId);
    if (instance && instance.createdBy === ctx.actorId) {
      throw new HttpError(403, "SELF_APPROVAL_DENIED", "the submitter of a workflow may not approve their own request");
    }
  }

  const projected: TaskView = { ...existing, status: "completed", decision, version: existing.version + 1 };
  await cache.put(cache.makeKey(ctx.tenantId, TASK_RESOURCE, taskId), projected);
  await queue.publish(COMMANDS.completeTask, {
    messageId: taskId,
    type: COMMANDS.completeTask,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...existing, decision },
  });

  return { id: taskId, status: "accepted", correlationId: ctx.correlationId };
}
