import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as tenderRepo from "./repo.js";
import { assertTenderAmendable, TenderDocsDomainError } from "./docs-domain.js";
import type {
  AddDocBody, CreateCorrigendumBody, RepublishCorrigendumBody,
  CreatePrebidQueryBody, AnswerPrebidQueryBody,
} from "./docs-validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function tenderOr404(ctx: RequestContext, tenderId: string) {
  const t = await tenderRepo.findTenderById(tenderId);
  if (!t || t.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "tender not found");
  return t;
}

export async function addDocument(ctx: RequestContext, tenderId: string, body: AddDocBody): Promise<Accepted> {
  await tenderOr404(ctx, tenderId);
  const id = randomUUID();
  await queue.publish(COMMANDS.tenderDocAdd, {
    messageId: id, type: COMMANDS.tenderDocAdd,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenderId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "tender", tenderId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createCorrigendum(ctx: RequestContext, tenderId: string, body: CreateCorrigendumBody): Promise<Accepted> {
  const t = await tenderOr404(ctx, tenderId);
  try {
    assertTenderAmendable(t.status);
  } catch (err) {
    if (err instanceof TenderDocsDomainError) throw new HttpError(409, err.code, err.message);
    throw err;
  }
  const id = randomUUID();
  await queue.publish(COMMANDS.tenderCorrigendumCreate, {
    messageId: id, type: COMMANDS.tenderCorrigendumCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenderId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "tender", tenderId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function republishCorrigendum(ctx: RequestContext, tenderId: string, corrigendumId: string, body: RepublishCorrigendumBody): Promise<Accepted> {
  await tenderOr404(ctx, tenderId);
  await queue.publish(COMMANDS.tenderCorrigendumRepublish, {
    messageId: randomUUID(), type: COMMANDS.tenderCorrigendumRepublish,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenderId, corrigendumId, tenantId: ctx.tenantId, notes: body.notes },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "tender", tenderId));
  return { id: corrigendumId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createPrebidQuery(ctx: RequestContext, tenderId: string, body: CreatePrebidQueryBody): Promise<Accepted> {
  await tenderOr404(ctx, tenderId);
  const id = randomUUID();
  await queue.publish(COMMANDS.prebidQueryCreate, {
    messageId: id, type: COMMANDS.prebidQueryCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenderId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function answerPrebidQuery(ctx: RequestContext, tenderId: string, queryId: string, body: AnswerPrebidQueryBody): Promise<Accepted> {
  await tenderOr404(ctx, tenderId);
  await queue.publish(COMMANDS.prebidQueryAnswer, {
    messageId: randomUUID(), type: COMMANDS.prebidQueryAnswer,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenderId, queryId, tenantId: ctx.tenantId, answer: body.answer },
  });
  return { id: queryId, status: "accepted", correlationId: ctx.correlationId };
}

export async function publishPrebidQuery(ctx: RequestContext, tenderId: string, queryId: string): Promise<Accepted> {
  await tenderOr404(ctx, tenderId);
  await queue.publish(COMMANDS.prebidQueryPublish, {
    messageId: randomUUID(), type: COMMANDS.prebidQueryPublish,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenderId, queryId, tenantId: ctx.tenantId },
  });
  return { id: queryId, status: "accepted", correlationId: ctx.correlationId };
}
