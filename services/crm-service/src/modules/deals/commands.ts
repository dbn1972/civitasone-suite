import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";
import type { CreateDealBody, UpdateDealStageBody, UpdateDealBody } from "./validators.js";
import type { DealView } from "./schema.js";

const RESOURCE = "deal";

export type Accepted = { id: string; status: string; correlationId: string };

function formatValue(minor: bigint, currency: string): string {
  const major = Number(minor) / 100;
  if (major >= 1_00_00_000) return `Rs ${(major / 1_00_00_000).toFixed(1)} Cr`;
  if (major >= 1_00_000) return `Rs ${(major / 1_00_000).toFixed(0)} L`;
  return `${currency} ${major.toLocaleString("en-IN")}`;
}

export async function createDeal(ctx: RequestContext, body: CreateDealBody): Promise<Accepted> {
  const id = commandId(ctx, COMMANDS.createDeal);
  const valueMinor = BigInt(body.valueMinor);
  const nowIso = new Date().toISOString();
  const projected: DealView = {
    id,
    tenantId: ctx.tenantId,
    pipelineId: body.pipelineId ?? null,
    stageId: body.stageId ?? null,
    name: body.name,
    stage: body.stage,
    valueMinor: valueMinor.toString(),
    currency: body.currency,
    valueDisplay: formatValue(valueMinor, body.currency),
    contactId: body.contactId ?? null,
    contactName: null,
    ownerId: body.ownerId ?? ctx.actorId,
    closeDate: body.closeDate ?? null,
    closedAt: null,
    closeReason: null,
    closedValueMinor: null,
    probability: body.probability ?? 0,
    status: "active",
    product: body.product ?? null,
    quantity: body.quantity ?? null,
    competitors: body.competitors ?? [],
    nextStep: body.nextStep ?? null,
    expectedCloseDate: body.expectedCloseDate ?? null,
    stageEnteredAt: nowIso,
    closeOutcome: null,
    closeCompetitor: null,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.createDeal, {
    messageId: id, type: COMMANDS.createDeal,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateDealStage(ctx: RequestContext, id: string, body: UpdateDealStageBody): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.updateDealStage}:${id}`);
  await queue.publish(COMMANDS.updateDealStage, {
    messageId: msgId, type: COMMANDS.updateDealStage,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      stage: body.stage,
      stageId: body.stageId,
      version: body.version,
      // `probability` here is only ever a caller-REQUESTED override; the consumer's
      // repo.updateStageWithVersion derives the real status/probability/closedAt from
      // the target stage regardless of whether this key is present at all.
      ...(body.probability !== undefined ? { probability: body.probability } : {}),
    },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateDeal(ctx: RequestContext, id: string, body: UpdateDealBody): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.updateDeal}:${id}`);
  await queue.publish(COMMANDS.updateDeal, {
    messageId: msgId, type: COMMANDS.updateDeal,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteDeal(ctx: RequestContext, id: string): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.deleteDeal}:${id}`);
  await queue.publish(COMMANDS.deleteDeal, {
    messageId: msgId, type: COMMANDS.deleteDeal,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
