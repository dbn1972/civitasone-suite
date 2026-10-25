import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import type { CreateStageBody } from "./validators.js";
import { nextStageStatus, type StageVerb } from "./domain.js";
import * as queries from "./queries.js";
import type { StageView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createStage(ctx: RequestContext, body: CreateStageBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: StageView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    stepNumber: body.stepNumber,
    description: body.description ?? null,
    status: "active",
    isRequired: true,
    completedAt: null,
    errorMessage: null,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.createStage, {
    messageId: id,
    type: COMMANDS.createStage,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export type StageTransitionPayload = { id: string; verb: StageVerb; remarks?: string };

/**
 * PATCH /v1/install/steps/:id/:verb. The id is an install.stages row (the
 * /v1/install/steps view is 1:1 over stages), NOT a wizard step, so it is
 * published on the dedicated stage-transition topic that the stages consumer
 * owns — never on install.step.start/skip, whose consumer expects a wizard
 * {wizardId, stepKey} and silently ignored this payload.
 */
export async function transitionStage(ctx: RequestContext, id: string, verb: StageVerb, remarks?: string): Promise<Accepted> {
  const stage = await queries.getStage(id, ctx.tenantId);
  if (!stage) throw new HttpError(404, "NOT_FOUND", "stage not found");
  if (!nextStageStatus(verb, stage.status)) {
    throw new HttpError(409, "INVALID_TRANSITION", `cannot ${verb} a step that is ${stage.status}`);
  }
  await queue.publish(COMMANDS.transitionStage, {
    messageId: randomUUID(),
    type: COMMANDS.transitionStage,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, verb, ...(remarks ? { remarks } : {}) } satisfies StageTransitionPayload,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
