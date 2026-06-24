import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, INSTANCE_RESOURCE } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as defRepo from "../definitions/repo.js";
import * as taskRepo from "../tasks/repo.js";
import * as historyRepo from "../history/repo.js";
import type { CreateInstanceBody } from "./validators.js";
import type { InstanceView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export type LifecyclePayload = {
  id: string;
  tenantId: string;
  fromStatus: string;
  toStatus: string;
  reason?: string;
};

/**
 * P0-2 — instance lifecycle (cancel / suspend / resume). We validate the
 * transition synchronously (existence, tenant scope, legal status change) so
 * the caller gets an immediate 404/409, then publish a command; the consumer
 * applies the status change and appends a transition_history row under a lock.
 */
async function publishLifecycle(
  ctx: RequestContext,
  instanceId: string,
  command: string,
  toStatus: string,
  allowedFrom: string[],
  reason: string | undefined,
): Promise<Accepted> {
  const instance = await repo.findById(instanceId, ctx.tenantId);
  if (!instance) throw new HttpError(404, "NOT_FOUND", "instance not found");
  if (instance.status === "completed" || instance.status === "cancelled") {
    throw new HttpError(409, "INSTANCE_TERMINAL", `instance is ${instance.status}; no further transitions allowed`);
  }
  if (!allowedFrom.includes(instance.status)) {
    throw new HttpError(409, "INVALID_TRANSITION", `cannot ${toStatus === "cancelled" ? "cancel" : toStatus === "suspended" ? "suspend" : "resume"} an instance in status '${instance.status}'`);
  }

  const payload: LifecyclePayload = {
    id: instanceId,
    tenantId: ctx.tenantId,
    fromStatus: instance.status,
    toStatus,
    ...(reason !== undefined ? { reason } : {}),
  };
  await queue.publish(command, {
    messageId: randomUUID(),
    type: command,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
  return { id: instanceId, status: "accepted", correlationId: ctx.correlationId };
}

export function cancelInstance(ctx: RequestContext, id: string, reason?: string): Promise<Accepted> {
  return publishLifecycle(ctx, id, COMMANDS.cancelInstance, "cancelled", ["active", "suspended"], reason);
}

export function suspendInstance(ctx: RequestContext, id: string, reason?: string): Promise<Accepted> {
  return publishLifecycle(ctx, id, COMMANDS.suspendInstance, "suspended", ["active"], reason);
}

export function resumeInstance(ctx: RequestContext, id: string, reason?: string): Promise<Accepted> {
  return publishLifecycle(ctx, id, COMMANDS.resumeInstance, "active", ["suspended"], reason);
}

export type CreateInstancePayload = InstanceView & {
  initialTaskName: string;
  definitionCode?: string;
  refType?: string;
  refId?: string;
  context?: Record<string, unknown>;
};

export async function createInstance(ctx: RequestContext, body: CreateInstanceBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: CreateInstancePayload = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    status: "active",
    version: 1,
    initialTaskName: "Review",
    ...(body.definitionCode !== undefined ? { definitionCode: body.definitionCode } : {}),
    ...(body.refType !== undefined ? { refType: body.refType } : {}),
    ...(body.refId !== undefined ? { refId: body.refId } : {}),
    ...(body.context !== undefined ? { context: body.context } : {}),
  };

  await cache.put(cache.makeKey(ctx.tenantId, INSTANCE_RESOURCE, id), projected);
  await queue.publish(COMMANDS.createInstance, {
    messageId: id,
    type: COMMANDS.createInstance,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export type MigrateResult = {
  id: string;
  fromVersion: number | null;
  toVersion: number;
  currentNode: string | null;
};

/**
 * P1-4 — in-flight instance version migration. Rebind a RUNNING (active or
 * suspended) instance from its pinned definition_version to another version of
 * the same definition code, synchronously and under the instance row lock.
 *
 * Safety:
 *  - instance must exist, be tenant-scoped, and not be terminal;
 *  - the target version must be a version of the SAME definition code;
 *  - the instance's current node key must still exist in the target version,
 *    UNLESS an explicit `nodeRemap[currentNode]` is supplied (and that remap
 *    target must exist in the target version) — otherwise 409, so we never
 *    strand the instance on a node the new graph doesn't have.
 * A transition_history row records the rebind (immutable audit).
 */
export async function migrateInstanceVersion(
  ctx: RequestContext,
  instanceId: string,
  toVersion: number,
  nodeRemap?: Record<string, string>,
): Promise<MigrateResult> {
  return db.transaction(async (tx) => {
    const instance = await repo.lockByIdTx(tx, instanceId);
    if (!instance || instance.tenantId !== ctx.tenantId) {
      throw new HttpError(404, "NOT_FOUND", "instance not found");
    }
    if (instance.status === "completed" || instance.status === "cancelled") {
      throw new HttpError(409, "INSTANCE_TERMINAL", `instance is ${instance.status}; cannot migrate`);
    }
    if (!instance.definitionId) {
      throw new HttpError(409, "NO_DEFINITION", "instance is not bound to a definition");
    }

    const currentDef = await defRepo.findById(instance.definitionId, ctx.tenantId);
    if (!currentDef) throw new HttpError(409, "NO_DEFINITION", "current definition not found");

    const target = await defRepo.findByCodeVersionTx(tx, ctx.tenantId, currentDef.code, toVersion);
    if (!target) {
      throw new HttpError(404, "VERSION_NOT_FOUND", `version ${toVersion} of '${currentDef.code}' not found`);
    }
    if (target.id === instance.definitionId) {
      throw new HttpError(409, "SAME_VERSION", "instance is already on that version");
    }

    // node-key remap validation against the target version's node set.
    const targetKeys = new Set(await defRepo.listNodeKeysTx(tx, target.id));
    let newCurrentNode = instance.currentNode;
    if (instance.currentNode) {
      const remapped = nodeRemap?.[instance.currentNode];
      if (remapped !== undefined) {
        if (!targetKeys.has(remapped)) {
          throw new HttpError(409, "INVALID_REMAP", `remap target '${remapped}' does not exist in version ${toVersion}`);
        }
        newCurrentNode = remapped;
      } else if (!targetKeys.has(instance.currentNode)) {
        throw new HttpError(409, "NODE_NOT_IN_TARGET", `current node '${instance.currentNode}' is absent in version ${toVersion}; supply a nodeRemap`);
      }
    }

    const ok = await repo.rebindDefinition(
      tx, instanceId, target.id, target.version, newCurrentNode ?? null, ctx.actorId, instance.version,
    );
    if (!ok) throw new HttpError(409, "CONFLICT", "instance changed concurrently; retry");

    // Remap any pending tasks sitting at the old current node to the new node so
    // the instance truly continues on the v2 graph: completing such a task now
    // resolves edges from the v2 node, not the (possibly absent) v1 node key.
    if (instance.currentNode && newCurrentNode) {
      const targetNode = await defRepo.findNodeByKeyTx(tx, target.id, newCurrentNode);
      if (targetNode) {
        await taskRepo.remapOpenTaskNode(
          tx, instanceId, instance.currentNode, newCurrentNode, targetNode.name, targetNode.roleRef, ctx.actorId,
        );
      }
    }

    await historyRepo.record(tx, {
      tenantId: ctx.tenantId,
      instanceId,
      taskId: null,
      fromNode: instance.currentNode ?? null,
      toNode: newCurrentNode ?? null,
      action: "migrate_version",
      decision: null,
      actorId: ctx.actorId,
      detail: {
        code: currentDef.code,
        fromVersion: instance.definitionVersion,
        toVersion: target.version,
        fromDefinitionId: instance.definitionId,
        toDefinitionId: target.id,
        ...(instance.currentNode && newCurrentNode !== instance.currentNode
          ? { nodeRemap: { [instance.currentNode]: newCurrentNode } }
          : {}),
      },
    });

    await cache.invalidateResource(ctx.tenantId, INSTANCE_RESOURCE);
    return {
      id: instanceId,
      fromVersion: instance.definitionVersion,
      toVersion: target.version,
      currentNode: newCurrentNode ?? null,
    };
  });
}
