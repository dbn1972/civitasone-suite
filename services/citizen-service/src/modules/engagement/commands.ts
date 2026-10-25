import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateAlertBody, CreateNoticeBody, CreateSurveyBody, SubmitResponseBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function send(ctx: RequestContext, topic: string, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(topic, {
    messageId: randomUUID(), type: topic,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export const createAlert = (ctx: RequestContext, body: CreateAlertBody): Promise<Accepted> =>
  send(ctx, COMMANDS.alertCreate, randomUUID(), { ...body });
export const publishAlert = (ctx: RequestContext, id: string): Promise<Accepted> => send(ctx, COMMANDS.alertPublish, id, {});
export const withdrawAlert = (ctx: RequestContext, id: string): Promise<Accepted> => send(ctx, COMMANDS.alertWithdraw, id, {});

export function createNotice(ctx: RequestContext, body: CreateNoticeBody): Promise<Accepted> {
  const id = randomUUID();
  // When staff do not supply a noticeNo the CONSUMER allocates NTC-YYYY-NNNNNN from a Postgres
  // sequence inside the insert transaction (shared/numbers.ts); a supplied one is passed through.
  return send(ctx, COMMANDS.noticeCreate, id, { ...body });
}
export const publishNotice = (ctx: RequestContext, id: string): Promise<Accepted> => send(ctx, COMMANDS.noticePublish, id, {});
export const withdrawNotice = (ctx: RequestContext, id: string): Promise<Accepted> => send(ctx, COMMANDS.noticeWithdraw, id, {});

export const createSurvey = (ctx: RequestContext, body: CreateSurveyBody): Promise<Accepted> =>
  send(ctx, COMMANDS.surveyCreate, randomUUID(), { ...body });
export const publishSurvey = (ctx: RequestContext, id: string): Promise<Accepted> => send(ctx, COMMANDS.surveyPublish, id, {});
export const closeSurvey = (ctx: RequestContext, id: string): Promise<Accepted> => send(ctx, COMMANDS.surveyClose, id, {});

/** citizenId is always the authenticated actor (resolved in the route), never taken from the body. */
export const submitSurveyResponse = (ctx: RequestContext, surveyId: string, body: SubmitResponseBody): Promise<Accepted> =>
  send(ctx, COMMANDS.surveyRespond, surveyId, { citizenId: ctx.actorId, answers: body.answers });
