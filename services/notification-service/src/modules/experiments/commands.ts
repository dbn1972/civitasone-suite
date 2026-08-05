import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface VariantInput {
  key: string;
  allocationPct: number;
  templateId?: string | undefined;
}

export interface CreateExperimentPayload {
  name: string;
  variants: VariantInput[];
}

export interface RecordEngagementPayload {
  experimentId: string;
  variantId: string;
  eventType: "open" | "click";
  deliveryId?: string | undefined;
  linkPosition?: number | undefined;
  linkUrl?: string | undefined;
  occurredAt?: string | undefined;
}

export async function createExperiment(
  ctx: RequestContext, payload: CreateExperimentPayload,
): Promise<Accepted> {
  const id = randomUUID();
  // Variant ids are minted here (not in the consumer) so the caller can allocate
  // recipients to variants immediately without waiting for the write to land.
  const variants = payload.variants.map((v) => ({ id: randomUUID(), ...v }));
  await queue.publish(COMMANDS.createExperiment, {
    messageId: id, type: COMMANDS.createExperiment, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, name: payload.name, variants },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordEngagement(
  ctx: RequestContext, payload: RecordEngagementPayload,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.recordExperimentEvent, {
    messageId: id, type: COMMANDS.recordExperimentEvent, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function concludeExperiment(ctx: RequestContext, experimentId: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.concludeExperiment, {
    messageId, type: COMMANDS.concludeExperiment, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: experimentId, tenantId: ctx.tenantId },
  });
  return { id: experimentId, status: "accepted", correlationId: ctx.correlationId };
}


/** P2-9 step 1 — freeze analysis and mark pending_approval (does not publish winner yet). */
export async function requestWinnerApproval(ctx: RequestContext, experimentId: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.requestWinnerApproval, {
    messageId, type: COMMANDS.requestWinnerApproval, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { id: experimentId, tenantId: ctx.tenantId },
  });
  return { id: experimentId, status: "accepted", correlationId: ctx.correlationId };
}

/** P2-9 step 2 — approval-gated promotion of the winner. */
export async function approveWinner(ctx: RequestContext, experimentId: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.concludeExperiment, {
    messageId, type: COMMANDS.concludeExperiment, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { id: experimentId, tenantId: ctx.tenantId },
  });
  return { id: experimentId, status: "accepted", correlationId: ctx.correlationId };
}
