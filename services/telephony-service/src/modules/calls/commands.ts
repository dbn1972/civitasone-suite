/**
 * Command handlers (WRITE PATH) — validate, publish the command, prime/invalidate
 * cache, return 202-accepted. The consumer is the only code that writes Postgres.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import { INITIAL_STATUS } from "./transitions.js";
import { dial, isConfigured as isCarrierConfigured } from "../../shared/carrier-adapter.js";
import type {
  CreateCallBody,
  RingCallBody,
  AnswerCallBody,
  CompleteCallBody,
  EndCallBody,
  AssignCallBody,
  IvrHitBody,
  LinkCallBody,
  RecordingBody,
} from "./validators.js";
import type { CallView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

function publish(ctx: RequestContext, type: string, messageId: string, payload: Record<string, unknown>): Promise<string> {
  return queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
}

function key(ctx: RequestContext, id: string): string {
  return cache.makeKey(ctx.tenantId, RESOURCE, id);
}

async function invalidate(ctx: RequestContext, id: string): Promise<void> {
  await cache.invalidate(key(ctx, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
}

export async function createCall(ctx: RequestContext, body: CreateCallBody): Promise<Accepted> {
  const id = randomUUID();
  const status = INITIAL_STATUS[body.direction];
  const nowIso = new Date().toISOString();

  // Prime the read cache with the projected view (cleartext in app; masked at read).
  const projected: CallView = {
    id,
    tenantId: ctx.tenantId,
    direction: body.direction,
    callerNumber: body.callerNumber ?? null,
    calleeNumber: body.calleeNumber ?? null,
    status,
    disposition: null,
    queueId: body.queueId ?? null,
    agentId: body.agentId ?? null,
    ivrPath: [],
    linkedRefType: body.linkedRefType ?? null,
    linkedRefId: body.linkedRefId ?? null,
    recordingId: null,
    recordingUrl: null,
    recordingDurationSec: null,
    recordingFormat: null,
    queuedAt: status === "queued" ? nowIso : null,
    ringingAt: status === "ringing" ? nowIso : null,
    answeredAt: null,
    endedAt: null,
    waitSeconds: null,
    talkSeconds: null,
    version: 1,
  };
  await cache.put(key(ctx, id), projected);

  await publish(ctx, COMMANDS.createCall, id, {
    id,
    tenantId: ctx.tenantId,
    direction: body.direction,
    callerNumber: body.callerNumber ?? null,
    calleeNumber: body.calleeNumber ?? null,
    status,
    queueId: body.queueId ?? null,
    agentId: body.agentId ?? null,
    linkedRefType: body.linkedRefType ?? null,
    linkedRefId: body.linkedRefId ?? null,
  });

  // For outbound calls, invoke the carrier adapter to actually place the call.
  // Env-gated: when carrier is unconfigured (mock mode), the call is recorded
  // but no actual dialing occurs.
  if (body.direction === "outbound" && body.calleeNumber) {
    if (isCarrierConfigured()) {
      try {
        const dialResult = await dial({
          from: body.callerNumber ?? "",
          to: body.calleeNumber,
          recordCall: true,
        });
        // The carrier's callId is stored by the consumer via a subsequent event
        await publish(ctx, COMMANDS.ringCall, randomUUID(), {
          id, tenantId: ctx.tenantId, carrierCallId: dialResult.carrierCallId,
        });
      } catch {
        // Carrier failure — call is recorded as queued but not connected
        // Consumer will handle timeout/abandonment
      }
    }
  }

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function ringCall(ctx: RequestContext, id: string, body: RingCallBody): Promise<Accepted> {
  await publish(ctx, COMMANDS.ringCall, randomUUID(), { id, tenantId: ctx.tenantId, ...body });
  await invalidate(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function answerCall(ctx: RequestContext, id: string, body: AnswerCallBody): Promise<Accepted> {
  await publish(ctx, COMMANDS.answerCall, randomUUID(), { id, tenantId: ctx.tenantId, ...body });
  await invalidate(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeCall(ctx: RequestContext, id: string, body: CompleteCallBody): Promise<Accepted> {
  await publish(ctx, COMMANDS.completeCall, randomUUID(), { id, tenantId: ctx.tenantId, ...body });
  await invalidate(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function missCall(ctx: RequestContext, id: string, body: EndCallBody): Promise<Accepted> {
  await publish(ctx, COMMANDS.missCall, randomUUID(), { id, tenantId: ctx.tenantId, ...body });
  await invalidate(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function abandonCall(ctx: RequestContext, id: string, body: EndCallBody): Promise<Accepted> {
  await publish(ctx, COMMANDS.abandonCall, randomUUID(), { id, tenantId: ctx.tenantId, ...body });
  await invalidate(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function assignCall(ctx: RequestContext, id: string, body: AssignCallBody): Promise<Accepted> {
  await publish(ctx, COMMANDS.assignCall, randomUUID(), { id, tenantId: ctx.tenantId, ...body });
  await invalidate(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordIvrHit(ctx: RequestContext, id: string, body: IvrHitBody): Promise<Accepted> {
  await publish(ctx, COMMANDS.recordIvrHit, randomUUID(), { id, tenantId: ctx.tenantId, ...body });
  await invalidate(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function linkCall(ctx: RequestContext, id: string, body: LinkCallBody): Promise<Accepted> {
  await publish(ctx, COMMANDS.linkCall, randomUUID(), { id, tenantId: ctx.tenantId, ...body });
  await invalidate(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function attachRecording(ctx: RequestContext, id: string, body: RecordingBody): Promise<Accepted> {
  await publish(ctx, COMMANDS.attachRecording, randomUUID(), { id, tenantId: ctx.tenantId, ...body });
  await invalidate(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
