import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateRtiBody, TransferRtiBody, ThirdPartyConsultBody, AdditionalFeeBody,
  RespondRtiBody, FileAppealBody, AppealOrderBody, DisclosureBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

function invalidate(ctx: RequestContext, id: string): Promise<void> {
  return cache.invalidate(cache.makeKey(ctx.tenantId, "rti", id));
}

export async function createApplication(ctx: RequestContext, body: CreateRtiBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.rtiApplicationCreate, {
    messageId: id, type: COMMANDS.rtiApplicationCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "rti", "list:50"));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function transferApplication(ctx: RequestContext, applicationId: string, body: TransferRtiBody): Promise<Accepted> {
  await queue.publish(COMMANDS.rtiTransfer, {
    messageId: randomUUID(), type: COMMANDS.rtiTransfer,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { applicationId, tenantId: ctx.tenantId, ...body },
  });
  await invalidate(ctx, applicationId);
  return { id: applicationId, status: "accepted", correlationId: ctx.correlationId };
}

export async function startThirdPartyConsult(ctx: RequestContext, applicationId: string, body: ThirdPartyConsultBody): Promise<Accepted> {
  await queue.publish(COMMANDS.rtiThirdPartyConsult, {
    messageId: randomUUID(), type: COMMANDS.rtiThirdPartyConsult,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { applicationId, tenantId: ctx.tenantId, ...body },
  });
  await invalidate(ctx, applicationId);
  return { id: applicationId, status: "accepted", correlationId: ctx.correlationId };
}

export async function levyAdditionalFee(ctx: RequestContext, applicationId: string, body: AdditionalFeeBody): Promise<Accepted> {
  await queue.publish(COMMANDS.rtiAdditionalFee, {
    messageId: randomUUID(), type: COMMANDS.rtiAdditionalFee,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { applicationId, tenantId: ctx.tenantId, ...body },
  });
  await invalidate(ctx, applicationId);
  return { id: applicationId, status: "accepted", correlationId: ctx.correlationId };
}

export async function respond(ctx: RequestContext, applicationId: string, body: RespondRtiBody): Promise<Accepted> {
  await queue.publish(COMMANDS.rtiRespond, {
    messageId: randomUUID(), type: COMMANDS.rtiRespond,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { applicationId, tenantId: ctx.tenantId, ...body },
  });
  await invalidate(ctx, applicationId);
  return { id: applicationId, status: "accepted", correlationId: ctx.correlationId };
}

export async function fileAppeal(ctx: RequestContext, applicationId: string, body: FileAppealBody): Promise<Accepted> {
  const appealId = randomUUID();
  await queue.publish(COMMANDS.rtiAppealFile, {
    messageId: appealId, type: COMMANDS.rtiAppealFile,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { appealId, applicationId, tenantId: ctx.tenantId, ...body },
  });
  await invalidate(ctx, applicationId);
  return { id: appealId, status: "accepted", correlationId: ctx.correlationId };
}

/** Maker-checker step: the appellate authority passes the order on the appeal. */
export async function decideAppeal(ctx: RequestContext, appealId: string, body: AppealOrderBody): Promise<Accepted> {
  await queue.publish(COMMANDS.rtiAppealOrder, {
    messageId: randomUUID(), type: COMMANDS.rtiAppealOrder,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { appealId, tenantId: ctx.tenantId, ...body },
  });
  return { id: appealId, status: "accepted", correlationId: ctx.correlationId };
}

export async function logDisclosure(ctx: RequestContext, applicationId: string | null, body: DisclosureBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.rtiDisclosureLog, {
    messageId: id, type: COMMANDS.rtiDisclosureLog,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, applicationId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
