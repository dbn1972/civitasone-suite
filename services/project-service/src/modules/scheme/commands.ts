import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateSchemeBody, CreateComponentBody, CreateFundReleaseBody, DisburseBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createScheme(ctx: RequestContext, body: CreateSchemeBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.schemeCreate, {
    messageId: id, type: COMMANDS.schemeCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createComponent(ctx: RequestContext, schemeId: string, body: CreateComponentBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.schemeComponentCreate, {
    messageId: id, type: COMMANDS.schemeComponentCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, schemeId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createFundRelease(ctx: RequestContext, schemeId: string, body: CreateFundReleaseBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.fundReleaseCreate, {
    messageId: id, type: COMMANDS.fundReleaseCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, schemeId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function disburseFundRelease(ctx: RequestContext, schemeId: string, rId: string, body: DisburseBody): Promise<Accepted> {
  await queue.publish(COMMANDS.fundReleaseDisburse, {
    messageId: randomUUID(), type: COMMANDS.fundReleaseDisburse,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { rId, tenantId: ctx.tenantId, schemeId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "scheme", schemeId));
  return { id: rId, status: "accepted", correlationId: ctx.correlationId };
}
