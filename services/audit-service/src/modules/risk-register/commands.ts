import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateControlBody, TestControlBody, CreateIncidentBody, CreateMitigationBody,
  ProposeAcceptanceBody, DecideAcceptanceBody, ReviewRiskBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function pub(ctx: RequestContext, topic: string, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(topic, {
    messageId: randomUUID(), type: topic,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createControl(ctx: RequestContext, body: CreateControlBody): Promise<Accepted> {
  const id = randomUUID();
  return pub(ctx, COMMANDS.riskControlCreate, id, { id, ...body });
}

export async function testControl(ctx: RequestContext, controlId: string, body: TestControlBody): Promise<Accepted> {
  const id = randomUUID();
  return pub(ctx, COMMANDS.riskControlTest, id, { id, controlId, ...body });
}

export async function createIncident(ctx: RequestContext, body: CreateIncidentBody): Promise<Accepted> {
  const id = randomUUID();
  return pub(ctx, COMMANDS.riskIncidentCreate, id, { id, ...body });
}

export async function createMitigation(ctx: RequestContext, body: CreateMitigationBody): Promise<Accepted> {
  const id = randomUUID();
  return pub(ctx, COMMANDS.riskMitigationCreate, id, { id, ...body });
}

export async function proposeAcceptance(ctx: RequestContext, body: ProposeAcceptanceBody): Promise<Accepted> {
  const id = randomUUID();
  return pub(ctx, COMMANDS.riskAcceptancePropose, id, { id, ...body });
}

/** Maker-checker: a different authority approves/rejects the acceptance. */
export async function decideAcceptance(ctx: RequestContext, acceptanceId: string, body: DecideAcceptanceBody): Promise<Accepted> {
  await cache.invalidate(cache.makeKey(ctx.tenantId, "risk_acceptance", acceptanceId));
  return pub(ctx, COMMANDS.riskAcceptanceDecide, acceptanceId, { acceptanceId, ...body });
}

export async function reviewRisk(ctx: RequestContext, body: ReviewRiskBody): Promise<Accepted> {
  const id = randomUUID();
  return pub(ctx, COMMANDS.riskReview, id, { id, ...body });
}
