/** Command publishers for lead assignment & escalation (AS-001..004). */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function pub(
  ctx: RequestContext,
  type: string,
  scope: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<Accepted> {
  const messageId = commandId(ctx, `${type}:${scope}`);
  await queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

// ── Assignment rules CRUD ────────────────────────────────────────────────────

export function createAssignmentRule(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  return pub(ctx, COMMANDS.createAssignmentRule, id, id, body);
}

export function updateAssignmentRule(ctx: RequestContext, id: string, body: Record<string, unknown>): Promise<Accepted> {
  return pub(ctx, COMMANDS.updateAssignmentRule, id, id, body);
}

export function deleteAssignmentRule(ctx: RequestContext, id: string): Promise<Accepted> {
  return pub(ctx, COMMANDS.deleteAssignmentRule, id, id, {});
}

// ── Manual assign / accept ───────────────────────────────────────────────────

export function assignLeadManual(
  ctx: RequestContext,
  leadId: string,
  body: { ownerId?: string | undefined; runRules?: boolean | undefined },
): Promise<Accepted> {
  return pub(ctx, COMMANDS.assignLeadManual, leadId, leadId, {
    leadId,
    ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
    runRules: body.runRules === true,
  });
}

export function acceptLead(ctx: RequestContext, leadId: string): Promise<Accepted> {
  return pub(ctx, COMMANDS.acceptLead, leadId, leadId, { leadId });
}

// ── Assignment targets (AS-002) ──────────────────────────────────────────────

export function createTarget(
  ctx: RequestContext,
  type: string,
  body: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  return pub(ctx, type, id, id, body);
}

export function deleteTarget(ctx: RequestContext, type: string, id: string): Promise<Accepted> {
  return pub(ctx, type, id, id, {});
}

// ── Escalation rules (AS-004) ────────────────────────────────────────────────

export function upsertEscalationRule(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  const id = (body.id as string) ?? randomUUID();
  return pub(ctx, COMMANDS.upsertEscalationRule, id, id, body);
}

export function deleteEscalationRule(ctx: RequestContext, id: string): Promise<Accepted> {
  return pub(ctx, COMMANDS.deleteEscalationRule, id, id, {});
}
