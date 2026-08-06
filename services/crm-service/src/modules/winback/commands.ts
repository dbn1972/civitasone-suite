/**
 * winback/commands.ts — Command publishing helpers for win-back cadence operations.
 */
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "@civitasone/types";
import type { CreateCadenceInput, UpdateCadenceInput } from "./validators.js";

interface CommandEnvelope {
  tenantId: string;
  actorId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

function envelope(ctx: RequestContext, payload: Record<string, unknown>): CommandEnvelope {
  return {
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload,
  };
}

export function publishCreateCadence(ctx: RequestContext, id: string, input: CreateCadenceInput): Promise<void> {
  return queue.publish(COMMANDS.createWinbackCadence, envelope(ctx, { id, ...input }));
}

export function publishUpdateCadence(ctx: RequestContext, id: string, input: UpdateCadenceInput, version: number): Promise<void> {
  return queue.publish(COMMANDS.updateWinbackCadence, envelope(ctx, { id, ...input, version }));
}

export function publishEnrollAccount(ctx: RequestContext, id: string, cadenceId: string, accountId: string): Promise<void> {
  return queue.publish(COMMANDS.enrollWinbackAccount, envelope(ctx, { id, cadenceId, accountId }));
}

export function publishAdvanceEnrollment(ctx: RequestContext, enrollmentId: string, version: number): Promise<void> {
  return queue.publish(COMMANDS.advanceWinbackStep, envelope(ctx, { enrollmentId, version }));
}

export function publishCancelEnrollment(ctx: RequestContext, enrollmentId: string, version: number): Promise<void> {
  return queue.publish(COMMANDS.cancelWinbackEnrollment, envelope(ctx, { enrollmentId, version }));
}

export function publishRecordOutcome(ctx: RequestContext, enrollmentId: string, outcome: string, version: number): Promise<void> {
  return queue.publish(COMMANDS.recordWinbackOutcome, envelope(ctx, { enrollmentId, outcome, version }));
}
