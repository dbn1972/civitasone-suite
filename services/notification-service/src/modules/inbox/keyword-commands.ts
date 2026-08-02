import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { MatchType } from "./keyword-domain.js";
import type { HandoffAction } from "./handoff-domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface CreateKeywordRulePayload {
  keyword: string;
  matchType: MatchType;
  channel?: string | undefined;
  priority: number;
  responseBody?: string | undefined;
  action?: string | undefined;
}

export interface UpdateKeywordRulePayload {
  keyword?: string | undefined;
  matchType?: MatchType | undefined;
  channel?: string | null | undefined;
  priority?: number | undefined;
  responseBody?: string | null | undefined;
  action?: string | null | undefined;
  enabled?: boolean | undefined;
}

export async function createKeywordRule(
  ctx: RequestContext, payload: CreateKeywordRulePayload,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createKeywordRule, {
    messageId: id, type: COMMANDS.createKeywordRule, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateKeywordRule(
  ctx: RequestContext, id: string, payload: UpdateKeywordRulePayload,
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.updateKeywordRule, {
    messageId, type: COMMANDS.updateKeywordRule, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface HandoffTransitionPayload {
  conversationId: string;
  action: HandoffAction;
  agentId?: string | undefined;
  reason?: string | undefined;
  /**
   * The state the route validated against. The consumer re-validates from this
   * expected value so a stale/concurrent request cannot apply a transition that
   * was legal when the request arrived but is not legal now.
   */
  expectedFromState: string;
}

export async function transitionHandoff(
  ctx: RequestContext, payload: HandoffTransitionPayload,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.transitionHandoff, {
    messageId: id, type: COMMANDS.transitionHandoff, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
