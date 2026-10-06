import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import type { CreateContractorBody } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(type, {
    messageId: id, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createContractor(ctx: RequestContext, body: CreateContractorBody): Promise<Accepted> {
  const id = randomUUID();
  return publish(COMMANDS.contractorCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
}

export async function rateContractor(ctx: RequestContext, contractorId: string, rating: number, comment?: string): Promise<Accepted> {
  const messageId = randomUUID();
  return publish(COMMANDS.contractorRate, ctx, messageId, {
    id: contractorId, tenantId: ctx.tenantId, rating,
    ...(comment ? { comment } : {}),
  });
}

/**
 * GAP-WORKS-CONTRACTORS-DETAIL-02: audited PAN reveal (DPDP). Reads the
 * (transparently-decrypted) PAN, records an audit event carrying the actor and
 * the stated reason — NEVER the PAN value — in the same outbox transaction,
 * then returns the clear value to the caller. Returns null when the contractor
 * has no PAN on record.
 */
export async function revealContractorPan(
  ctx: RequestContext,
  contractorId: string,
  reason: string,
): Promise<{ value: string | null }> {
  const contractor = await repo.findContractorById(ctx.tenantId, contractorId);
  if (!contractor) return { value: null };
  const value = contractor.pan ?? null;
  await db.transaction(async (tx) => {
    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: {
        service: "works",
        action: "reveal_pan",
        resourceType: "contractor",
        resourceId: contractorId,
        reason,
        outcome: "success",
      },
    });
  });
  return { value };
}
