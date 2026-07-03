/**
 * Role Features command handlers (WRITE PATH).
 * Route → validate → publish command to SQS → return 202.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { GrantFeatureBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function grantFeature(ctx: RequestContext, body: GrantFeatureBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.roleFeatureGrant, {
    messageId: id,
    type: COMMANDS.roleFeatureGrant,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, grantedBy: ctx.actorId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function revokeFeature(ctx: RequestContext, grantId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.roleFeatureRevoke, {
    messageId: id,
    type: COMMANDS.roleFeatureRevoke,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { grantId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
