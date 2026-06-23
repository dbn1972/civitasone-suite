import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateDealBody, UpdateDealStageBody } from "./validators.js";
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
  const id = randomUUID();
  const valueMinor = BigInt(body.valueMinor);
  const projected: DealView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    stage: body.stage,
    valueMinor: valueMinor.toString(),
    currency: body.currency,
    valueDisplay: formatValue(valueMinor, body.currency),
    contactId: body.contactId ?? null,
    contactName: null,
    ownerId: body.ownerId ?? ctx.actorId,
    closeDate: body.closeDate ?? null,
    probability: body.probability ?? 0,
    status: "active",
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
  const msgId = randomUUID();
  await queue.publish(COMMANDS.updateDealStage, {
    messageId: msgId, type: COMMANDS.updateDealStage,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, stage: body.stage },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
