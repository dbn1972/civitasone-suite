import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { PolicyBody, ClaimBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createPolicy(ctx: RequestContext, body: PolicyBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.insurancePolicyCreate, {
    messageId: id, type: COMMANDS.insurancePolicyCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createClaim(ctx: RequestContext, body: ClaimBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.insuranceClaimCreate, {
    messageId: id, type: COMMANDS.insuranceClaimCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
