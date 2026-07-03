/**
 * Plan command handlers (WRITE PATH).
 * Rule: NO Postgres writes here. Validate → publish command → prime cache → return 202.
 * The consumer does the durable DB write.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreatePlanBody, UpdatePlanBody } from "./validators.js";
import type { PlanView } from "./repo.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = "plan";

export async function planCreate(ctx: RequestContext, body: CreatePlanBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: PlanView = {
    id,
    tenantId: ctx.tenantId,
    code: body.code,
    name: body.name,
    edition: body.edition,
    maxUsers: body.maxUsers,
    maxStorageGb: body.maxStorageGb,
    enabledModules: body.enabledModules,
    priceMinor: body.priceMinor,
    billingCycle: body.billingCycle,
    features: body.features,
    version: 1,
  };
  // read-your-writes: prime cache
  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);

  await queue.publish(COMMANDS.planCreate, {
    messageId: id,
    type: COMMANDS.planCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function planUpdate(ctx: RequestContext, planId: string, body: UpdatePlanBody): Promise<Accepted> {
  await queue.publish(COMMANDS.planUpdate, {
    type: COMMANDS.planUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: planId, ...body },
  });
  return { id: planId, status: "accepted", correlationId: ctx.correlationId };
}
