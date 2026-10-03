/**
 * GAP-PAYROLL-TAX-DECLARATION-02: command publishers for investment proofs.
 * Routes call these and never write the database; the consumers in
 * ./consumer.ts do the write in a transaction with an audit outbox event.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { ProofLine } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(ctx: RequestContext, topic: string, entityId: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(topic, {
    messageId: randomUUID(),
    type: topic,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: entityId, tenantId: ctx.tenantId, ...payload },
  });
  return { id: entityId, status: "accepted", correlationId: ctx.correlationId };
}

export interface SubmitProofInput {
  employeeId: string;
  fy: string;
  line: ProofLine;
  storageKey: string;
  filename: string;
  /** Verified by the route against the object store (HEAD), not client-claimed. */
  contentType: string;
  sizeBytes: number;
  amountMinor?: number | undefined;
}

export function submitProof(ctx: RequestContext, input: SubmitProofInput): Promise<Accepted> {
  return publish(ctx, COMMANDS.taxProofSubmit, randomUUID(), { ...input });
}

export interface DecideProofInput {
  decision: "accepted" | "rejected";
  reason?: string | undefined;
  amountMinor?: number | undefined;
  /** The deciding officer's own hrms employee id (null when no employee record is linked). */
  deciderEmployeeId: string | null;
}

export function decideProof(ctx: RequestContext, id: string, input: DecideProofInput): Promise<Accepted> {
  return publish(ctx, COMMANDS.taxProofDecide, id, { ...input });
}

export function removeProof(ctx: RequestContext, id: string, ownEmployeeId: string): Promise<Accepted> {
  return publish(ctx, COMMANDS.taxProofRemove, id, { ownEmployeeId });
}

export function setLegalHold(ctx: RequestContext, id: string, hold: boolean, reason: string): Promise<Accepted> {
  return publish(ctx, COMMANDS.taxProofHold, id, { hold, reason });
}

export function setRetentionYears(ctx: RequestContext, years: number, reason: string | undefined): Promise<Accepted> {
  return publish(ctx, COMMANDS.taxProofRetentionSet, ctx.tenantId, { years, reason });
}

export function setProofCutoff(ctx: RequestContext, md: string, reason: string | undefined): Promise<Accepted> {
  return publish(ctx, COMMANDS.taxProofCutoffSet, ctx.tenantId, { md, reason });
}

export function setVerifiedFromFy(ctx: RequestContext, fy: string | null, reason: string | undefined): Promise<Accepted> {
  return publish(ctx, COMMANDS.taxProofVerifiedFromSet, ctx.tenantId, { fy, reason });
}

/**
 * Audit a proof view BEFORE the link is returned: the route awaits this durable
 * publish and fails closed (no link) if it cannot be queued.
 */
export function recordProofView(ctx: RequestContext, id: string, details: Record<string, unknown>): Promise<Accepted> {
  return publish(ctx, COMMANDS.taxProofViewAudit, id, { details });
}

/** Scheduler -> one purge command per tenant that has purge-due rows. */
export async function publishPurge(tenantId: string, actorId: string): Promise<void> {
  await queue.publish(COMMANDS.taxProofPurge, {
    messageId: randomUUID(),
    type: COMMANDS.taxProofPurge,
    tenantId,
    actorId,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload: { tenantId },
  });
}
