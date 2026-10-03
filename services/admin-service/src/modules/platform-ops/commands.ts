/**
 * Route -> publish command. Every handler here only publishes; the consumer is
 * the single writer. messageIds are fresh randomUUID()s: a repeatable decision
 * (a stage move, a second export of the same table) must never be de-duplicated
 * away by a deterministic id.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { OnboardingStage, PlatformAuditResource } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

function envelope<P>(ctx: RequestContext, type: string, id: string, payload: P) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  };
}

export interface DataAccessPayload {
  kind: "export" | "reveal";
  resource: PlatformAuditResource;
  resourceId?: string;
  rowCount?: number;
  filtered?: boolean;
  reason?: string;
  fields?: string[];
}

export async function recordDataAccess(ctx: RequestContext, p: DataAccessPayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.platformDataAccess, envelope(ctx, COMMANDS.platformDataAccess, id, p));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface CreateOnboardingPayload {
  orgName: string;
  contactName: string;
  contactEmail: string;
  notes?: string | undefined;
}

export async function createOnboardingRequest(ctx: RequestContext, p: CreateOnboardingPayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.onboardingCreate, envelope(ctx, COMMANDS.onboardingCreate, id, p));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface MoveOnboardingPayload {
  requestId: string;
  from: OnboardingStage;
  to: OnboardingStage;
  assignedTo?: string | null | undefined;
  assignedToName?: string | null | undefined;
  provisionedTenantId?: string | null | undefined;
  note?: string | undefined;
}

export async function moveOnboardingStage(ctx: RequestContext, p: MoveOnboardingPayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.onboardingMove, envelope(ctx, COMMANDS.onboardingMove, id, p));
  return { id: p.requestId, status: "accepted", correlationId: ctx.correlationId };
}
