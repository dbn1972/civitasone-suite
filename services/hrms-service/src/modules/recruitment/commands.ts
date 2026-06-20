import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateJobOpeningBody, CreateApplicationBody, OfferApplicationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createJobOpening(ctx: RequestContext, body: CreateJobOpeningBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.jobCreate, {
    messageId: id, type: COMMANDS.jobCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createApplication(ctx: RequestContext, body: CreateApplicationBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.applicationCreate, {
    messageId: id, type: COMMANDS.applicationCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function offerApplication(ctx: RequestContext, id: string, body: OfferApplicationBody): Promise<Accepted> {
  const offerId = randomUUID();
  await queue.publish(COMMANDS.applicationOffer, {
    messageId: offerId, type: COMMANDS.applicationOffer,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { offerId, applicationId: id, tenantId: ctx.tenantId, ...body },
  });
  return { id: offerId, status: "accepted", correlationId: ctx.correlationId };
}
