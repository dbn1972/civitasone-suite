import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { hasCycle, MAX_DEPS_PER_TASK } from "./domain.js";
import { countBaselines, MAX_BASELINES_PER_PROJECT } from "./baselines.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";
import { tenantTransaction } from "@civitasone/db";

export type Accepted = { id: string; status: string; correlationId: string };

/** Pre-validate cycle/max-deps (reads only), then publish. */
export async function createDependency(
  ctx: RequestContext,
  projectId: string,
  body: { fromTaskId: string; toTaskId: string; depType: string; lagMs: bigint },
): Promise<Accepted> {
  if (body.fromTaskId === body.toTaskId) {
    throw new HttpError(422, "SELF_DEPENDENCY", "a task cannot depend on itself");
  }

  await tenantTransaction(db, ctx.tenantId, async (tx) => {
    const txDb = tx as typeof db;
    const currentCount = await repo.countDepsForTask(txDb, projectId, ctx.tenantId, body.toTaskId);
    if (currentCount >= MAX_DEPS_PER_TASK) {
      throw new HttpError(422, "MAX_DEPS_EXCEEDED", `maximum ${MAX_DEPS_PER_TASK} dependencies per task`);
    }
    const existingDeps = await repo.getProjectDeps(txDb, projectId, ctx.tenantId);
    const proposedDeps = [...existingDeps, { fromTaskId: body.fromTaskId, toTaskId: body.toTaskId }];
    const cyclePath = hasCycle(proposedDeps);
    if (cyclePath) {
      throw new HttpError(422, "CIRCULAR_DEPENDENCY", `circular dependency detected: ${cyclePath.join(" → ")}`);
    }
  });

  const id = randomUUID();
  await queue.publish(COMMANDS.dependencyCreate, {
    messageId: id,
    type: COMMANDS.dependencyCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, projectId, fromTaskId: body.fromTaskId, toTaskId: body.toTaskId, depType: body.depType, lagMs: body.lagMs.toString() },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}


export async function deleteDependency(
  ctx: RequestContext, projectId: string, id: string,
): Promise<Accepted> {
  // Synchronous pre-accept existence check — without this, DELETE for a
  // nonexistent dependency id was silently accepted (202) and queued, then
  // no-oped in the async consumer with no channel back to the caller.
  const exists = await tenantTransaction(db, ctx.tenantId, (tx) =>
    repo.dependencyExists(tx as typeof db, id, projectId, ctx.tenantId));
  if (!exists) throw new HttpError(404, "NOT_FOUND", "dependency not found");

  await queue.publish(COMMANDS.dependencyDelete, {
    messageId: randomUUID(),
    type: COMMANDS.dependencyDelete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, projectId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createBaseline(
  ctx: RequestContext,
  projectId: string,
  body: { label: string; snapshotData: unknown },
): Promise<Accepted> {
  await tenantTransaction(db, ctx.tenantId, async (tx) => {
    const currentCount = await countBaselines(tx as typeof db, projectId, ctx.tenantId);
    if (currentCount >= MAX_BASELINES_PER_PROJECT) {
      throw new HttpError(422, "MAX_BASELINES_EXCEEDED", `maximum ${MAX_BASELINES_PER_PROJECT} baselines per project`);
    }
  });
  const id = randomUUID();
  await queue.publish(COMMANDS.baselineCreate, {
    messageId: id,
    type: COMMANDS.baselineCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, projectId, label: body.label, snapshotData: body.snapshotData },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
