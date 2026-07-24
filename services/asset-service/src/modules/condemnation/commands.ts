import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateSurveyBody, SubmitSurveyBody, CreateRecommendationBody,
  ApproveRecommendationBody, CreateAuctionBody, CompleteAuctionBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(type, {
    messageId: id, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
}

export async function createSurvey(ctx: RequestContext, body: CreateSurveyBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.condemnationSurveyCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitSurvey(ctx: RequestContext, surveyId: string, body: SubmitSurveyBody): Promise<Accepted> {
  await publish(COMMANDS.condemnationSurveySubmit, ctx, surveyId, { id: surveyId, tenantId: ctx.tenantId, ...body });
  return { id: surveyId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createRecommendation(ctx: RequestContext, body: CreateRecommendationBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.condemnationRecommend, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveRecommendation(ctx: RequestContext, recId: string, body: ApproveRecommendationBody): Promise<Accepted> {
  await publish(COMMANDS.condemnationApprove, ctx, recId, { id: recId, tenantId: ctx.tenantId, ...body });
  return { id: recId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createAuction(ctx: RequestContext, body: CreateAuctionBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.auctionCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeAuction(ctx: RequestContext, auctionId: string, body: CompleteAuctionBody): Promise<Accepted> {
  await publish(COMMANDS.auctionComplete, ctx, auctionId, { id: auctionId, tenantId: ctx.tenantId, ...body });
  return { id: auctionId, status: "accepted", correlationId: ctx.correlationId };
}
