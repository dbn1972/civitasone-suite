import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateCourtCaseBody, SetNextDateBody, CreateRtiBody, RespondRtiBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createCourtCase(ctx: RequestContext, body: CreateCourtCaseBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.courtCaseCreate, {
    messageId: id, type: COMMANDS.courtCaseCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function setNextDate(ctx: RequestContext, caseId: string, body: SetNextDateBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.courtCaseNextDate, {
    messageId: id, type: COMMANDS.courtCaseNextDate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, caseId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "court_case", caseId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createRti(ctx: RequestContext, body: CreateRtiBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.rtiCreate, {
    messageId: id, type: COMMANDS.rtiCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function respondRti(ctx: RequestContext, rtiId: string, body: RespondRtiBody): Promise<Accepted> {
  await queue.publish(COMMANDS.rtiRespond, {
    type: COMMANDS.rtiRespond,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { rtiId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "rti", rtiId));
  return { id: rtiId, status: "accepted", correlationId: ctx.correlationId };
}
