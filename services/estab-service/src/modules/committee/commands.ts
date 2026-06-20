import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateCommitteeBody, CreateMeetingBody, CreateResolutionBody, MinutesBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createCommittee(ctx: RequestContext, body: CreateCommitteeBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.committeeCreate, {
    messageId: id, type: COMMANDS.committeeCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createMeeting(ctx: RequestContext, committeeId: string, body: CreateMeetingBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.meetingCreate, {
    messageId: id, type: COMMANDS.meetingCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, committeeId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createResolution(ctx: RequestContext, meetingId: string, body: CreateResolutionBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.resolutionCreate, {
    messageId: id, type: COMMANDS.resolutionCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, meetingId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function uploadMinutes(ctx: RequestContext, meetingId: string, body: MinutesBody): Promise<Accepted> {
  await queue.publish(COMMANDS.meetingMinutes, {
    type: COMMANDS.meetingMinutes,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { meetingId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "meeting", meetingId));
  return { id: meetingId, status: "accepted", correlationId: ctx.correlationId };
}
