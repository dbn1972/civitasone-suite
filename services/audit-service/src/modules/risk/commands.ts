import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { computeRiskScore } from "./domain.js";
import type { CreateRiskBody, UpdateRiskBody, LinkRisksBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createRisk(ctx: RequestContext, body: CreateRiskBody): Promise<Accepted> {
  const id = randomUUID();
  // P1-7: score computed here from trusted inputs, then carried to the consumer.
  const riskScore = computeRiskScore(body.likelihood, body.impact);
  await queue.publish(COMMANDS.riskCreate, {
    messageId: id, type: COMMANDS.riskCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, riskScore },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "audit_risk", "list:50"));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateRisk(ctx: RequestContext, riskId: string, body: UpdateRiskBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.riskUpdate, {
    messageId, type: COMMANDS.riskUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { riskId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "audit_risk", "list:50"));
  return { id: riskId, status: "accepted", correlationId: ctx.correlationId };
}

export async function linkRisksToPlan(ctx: RequestContext, planId: string, body: LinkRisksBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.riskLinkPlan, {
    messageId, type: COMMANDS.riskLinkPlan,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { planId, tenantId: ctx.tenantId, riskIds: body.riskIds },
  });
  return { id: planId, status: "accepted", correlationId: ctx.correlationId };
}
