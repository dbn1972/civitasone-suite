/**
 * visitor-service: DPDP erasure command publisher.
 *
 * Task Q-95.2: the Right-to-Erasure endpoint (Requirement 18.4) previously
 * ran its `visit_requests` UPDATE synchronously inside the route handler.
 * The actual PII purge already happens asynchronously — a scheduled worker
 * (./purge-worker.ts) only acts on `erasure_requested_at` up to 72h later —
 * so marking the row for erasure can safely move onto the same
 * route -> zod validate -> publish -> 202 CQRS convention used everywhere
 * else in this service: the sub-second queue hop is negligible against the
 * 72h SLA and does NOT put the SLA at risk.
 *
 * `commands.ts` mints a deterministic `erasureId` BEFORE publishing and
 * returns it to the caller as part of the 202 Accepted body — the consumer
 * (./consumer.ts) uses it as the message id so a redelivery is idempotent.
 */
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface DpdpErasureRequestInput {
  erasureId: string;
  visitorRef?: string | undefined;
  visitorPhone?: string | undefined;
}

export async function dpdpErasureRequest(ctx: RequestContext, input: DpdpErasureRequestInput): Promise<Accepted> {
  await queue.publish(COMMANDS.dpdpErasureRequest, {
    messageId: input.erasureId,
    type: COMMANDS.dpdpErasureRequest,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      erasureId: input.erasureId,
      tenantId: ctx.tenantId,
      visitorRef: input.visitorRef ?? null,
      visitorPhone: input.visitorPhone ?? null,
    },
  });
  return { id: input.erasureId, status: "accepted", correlationId: ctx.correlationId };
}
