import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  RegisterGrievanceBody, AssignGrievanceBody, GrievanceActionBody,
  ResolveGrievanceBody, EscalateGrievanceBody, ReopenGrievanceBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function registerGrievance(ctx: RequestContext, body: RegisterGrievanceBody & { citizenId: string }): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.grievanceRegister, {
    messageId: id, type: COMMANDS.grievanceRegister,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function assignGrievance(ctx: RequestContext, id: string, body: AssignGrievanceBody): Promise<Accepted> {
  await queue.publish(COMMANDS.grievanceAssign, {
    messageId: randomUUID(), type: COMMANDS.grievanceAssign,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "grievance", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function addAction(ctx: RequestContext, id: string, body: GrievanceActionBody): Promise<Accepted> {
  const actionId = randomUUID();
  await queue.publish(COMMANDS.grievanceAction, {
    messageId: actionId, type: COMMANDS.grievanceAction,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: actionId, grievanceId: id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "grievance", id));
  return { id: actionId, status: "accepted", correlationId: ctx.correlationId };
}

export async function resolveGrievance(ctx: RequestContext, id: string, body: ResolveGrievanceBody): Promise<Accepted> {
  await queue.publish(COMMANDS.grievanceResolve, {
    messageId: randomUUID(), type: COMMANDS.grievanceResolve,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "grievance", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function escalateGrievance(ctx: RequestContext, id: string, body: EscalateGrievanceBody): Promise<Accepted> {
  const escId = randomUUID();
  await queue.publish(COMMANDS.grievanceEscalate, {
    messageId: escId, type: COMMANDS.grievanceEscalate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: escId, grievanceId: id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "grievance", id));
  return { id: escId, status: "accepted", correlationId: ctx.correlationId };
}

export async function reopenGrievance(ctx: RequestContext, id: string, body: ReopenGrievanceBody): Promise<Accepted> {
  await queue.publish(COMMANDS.grievanceReopen, {
    messageId: randomUUID(), type: COMMANDS.grievanceReopen,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason: body.reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "grievance", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
