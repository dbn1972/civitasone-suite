import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateWizardBody, CompleteStepBody } from "./validators.js";
import { computeInitialStatus } from "./domain.js";
import type { StepDef } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createWizard(ctx: RequestContext, body: CreateWizardBody): Promise<Accepted> {
  const id = randomUUID();

  const steps = body.steps.map((s) => ({
    stepKey: s.stepKey,
    title: s.title,
    description: s.description ?? null,
    isRequired: s.isRequired,
    dependsOn: s.dependsOn,
    handlerType: s.handlerType,
    config: s.config,
    sortOrder: s.sortOrder,
  }));

  const executions = body.steps.map((s) => {
    const def: StepDef = { stepKey: s.stepKey, isRequired: s.isRequired, dependsOn: s.dependsOn };
    return { stepKey: s.stepKey, status: computeInitialStatus(def) };
  });

  const projected = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    description: body.description ?? null,
    status: "active",
    steps,
    executions,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, "wizard", id), projected);
  await queue.publish(COMMANDS.wizardCreate, {
    messageId: id,
    type: COMMANDS.wizardCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function startStep(ctx: RequestContext, wizardId: string, stepKey: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.stepStart, {
    messageId: id,
    type: COMMANDS.stepStart,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { wizardId, stepKey },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeStep(ctx: RequestContext, wizardId: string, stepKey: string, body: CompleteStepBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.stepComplete, {
    messageId: id,
    type: COMMANDS.stepComplete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { wizardId, stepKey, output: body.output ?? {} },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function skipStep(ctx: RequestContext, wizardId: string, stepKey: string, reason?: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.stepSkip, {
    messageId: id,
    type: COMMANDS.stepSkip,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { wizardId, stepKey, reason },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
