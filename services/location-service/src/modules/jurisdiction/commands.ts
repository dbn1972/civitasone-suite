import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCES } from "../../topics.js";
import type { AssignJurisdictionBody } from "./validators.js";
import type { JurisdictionView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function jurisdictionAssign(ctx: RequestContext, body: AssignJurisdictionBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: JurisdictionView = {
    id,
    tenantId: ctx.tenantId,
    officeId: body.officeId,
    unitId: body.unitId,
    level: body.level,
    isPrimary: body.isPrimary,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCES.jurisdiction, id), projected);

  await queue.publish(COMMANDS.jurisdictionAssign, {
    messageId: id,
    type: COMMANDS.jurisdictionAssign,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function jurisdictionRevoke(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.jurisdictionRevoke, {
    messageId: randomUUID(),
    type: COMMANDS.jurisdictionRevoke,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
