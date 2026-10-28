import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateSurveyBody, SubmitSurveyBody, CreateRecommendationBody,
  ApproveRecommendationBody, CreateAuctionBody, CompleteAuctionBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * The entity id travels in the payload only. The queue messageId is a fresh id
 * per command: the consumer's inbox dedupe (markProcessed) keys on messageId, so reusing the entity id as the
 * messageId made every later command on that entity (survey submit, recommendation approve, auction complete) collide
 * with the create command's inbox row and be silently dropped (UAT DB test, asset defect 4).
 */
async function publish(type: string, ctx: RequestContext, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(type, {
    messageId: randomUUID(), type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
}

export async function createSurvey(ctx: RequestContext, body: CreateSurveyBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.condemnationSurveyCreate, ctx, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitSurvey(ctx: RequestContext, surveyId: string, body: SubmitSurveyBody): Promise<Accepted> {
  await publish(COMMANDS.condemnationSurveySubmit, ctx, { id: surveyId, tenantId: ctx.tenantId, ...body });
  return { id: surveyId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createRecommendation(ctx: RequestContext, body: CreateRecommendationBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.condemnationRecommend, ctx, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveRecommendation(ctx: RequestContext, recId: string, body: ApproveRecommendationBody): Promise<Accepted> {
  await publish(COMMANDS.condemnationApprove, ctx, { id: recId, tenantId: ctx.tenantId, ...body });
  return { id: recId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createAuction(ctx: RequestContext, body: CreateAuctionBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.auctionCreate, ctx, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeAuction(ctx: RequestContext, auctionId: string, body: CompleteAuctionBody): Promise<Accepted> {
  await publish(COMMANDS.auctionComplete, ctx, { id: auctionId, tenantId: ctx.tenantId, ...body });
  return { id: auctionId, status: "accepted", correlationId: ctx.correlationId };
}
