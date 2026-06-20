import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateNoticeBody, RespondNoticeBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createNotice(ctx: RequestContext, body: CreateNoticeBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.noticeCreate, {
    messageId: id, type: COMMANDS.noticeCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function respondNotice(ctx: RequestContext, noticeId: string, body: RespondNoticeBody): Promise<Accepted> {
  await queue.publish(COMMANDS.noticeRespond, {
    type: COMMANDS.noticeRespond,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { noticeId, tenantId: ctx.tenantId, ...body },
  });
  return { id: noticeId, status: "accepted", correlationId: ctx.correlationId };
}
