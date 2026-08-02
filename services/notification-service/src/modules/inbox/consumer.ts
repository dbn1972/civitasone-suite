/**
 * CR-MKT-06 + F.5 — inbox consumers.
 *
 * Also closes an existing gap: `notification.inbox.inbound_received` was being
 * published by inbound-routes.ts with NOTHING consuming it. It is now consumed
 * here to drive keyword auto-responses, so the command is no longer a dead end.
 *
 * PII: the inbound sender (phone/email) is stored encrypted and hashed for
 * lookups. It is never logged — log lines carry rule/conversation ids only.
 *
 * DLQ safety: malformed payloads and transitions that are illegal from the
 * recorded state are NonRetryableError; retrying them can never succeed.
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { blindIndex } from "../../shared/pii-crypto.js";
import { matchKeywordRule, planAutoResponse, type MatchType } from "./keyword-domain.js";
import {
  applyHandoffTransition,
  isHandoffState,
  INITIAL_HANDOFF_STATE,
  HANDOFF_ACTIONS,
  type HandoffAction,
  type HandoffState,
} from "./handoff-domain.js";
import * as repo from "./keyword-repo.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "consumer:inbox" });

/** Channels on which an automatic reply may be sent back to the sender. */
const AUTO_REPLY_CHANNELS = new Set(["sms", "whatsapp"]);

type CreateRulePayload = {
  id: string; tenantId: string; keyword: string; matchType: MatchType;
  channel?: string; priority: number; responseBody?: string; action?: string;
};

type UpdateRulePayload = {
  id: string; tenantId: string; keyword?: string; matchType?: MatchType;
  channel?: string | null; priority?: number; responseBody?: string | null;
  action?: string | null; enabled?: boolean;
};

type InboundPayload = {
  id: string; tenantId: string; channel: string; from: string; body: string;
  metadata?: Record<string, unknown>;
};

type HandoffPayload = {
  id: string; tenantId: string; conversationId: string; action: HandoffAction;
  agentId?: string; reason?: string; expectedFromState: string;
};

export function registerInboxConsumers(q: Queue): void {
  q = tenantScoped(q);

  q.subscribe<CreateRulePayload>(COMMANDS.createKeywordRule, async (msg) => {
    const p = msg.payload;
    if (typeof p.keyword !== "string" || p.keyword.trim().length === 0) {
      throw new NonRetryableError("INVALID_KEYWORD_RULE: keyword is required");
    }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertKeywordRule(tx, {
        id: p.id,
        tenantId: p.tenantId,
        keyword: p.keyword,
        matchType: p.matchType,
        channel: p.channel ?? null,
        priority: p.priority,
        responseBody: p.responseBody ?? null,
        action: p.action ?? null,
        enabled: true,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.keywordRuleCreated,
        eventType: EVENTS.keywordRuleCreated,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { ruleId: p.id, matchType: p.matchType, channel: p.channel ?? null },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "create_keyword_rule", resourceType: "keyword_rule",
          resourceId: p.id, outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(p.tenantId, "keyword_rules", "all"));
    log.info({ ruleId: p.id }, "keyword rule created");
  });

  q.subscribe<UpdateRulePayload>(COMMANDS.updateKeywordRule, async (msg) => {
    const p = msg.payload;
    // Returned from the transaction, not assigned to an outer `let`: TypeScript
    // cannot follow an assignment made inside an async callback and kept the
    // variable narrowed to its initialiser, so the check below did not compile.
    const outcome = await db.transaction(async (tx): Promise<"duplicate" | "updated" | "missing"> => {
      if (!(await markProcessed(tx, msg.messageId))) return "duplicate";
      const ok = await repo.updateKeywordRule(tx, p.tenantId, p.id, {
        ...(p.keyword !== undefined ? { keyword: p.keyword } : {}),
        ...(p.matchType !== undefined ? { matchType: p.matchType } : {}),
        ...(p.channel !== undefined ? { channel: p.channel } : {}),
        ...(p.priority !== undefined ? { priority: p.priority } : {}),
        ...(p.responseBody !== undefined ? { responseBody: p.responseBody } : {}),
        ...(p.action !== undefined ? { action: p.action } : {}),
        ...(p.enabled !== undefined ? { enabled: p.enabled } : {}),
      }, msg.actorId);
      if (!ok) return "missing";
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "update_keyword_rule", resourceType: "keyword_rule",
          resourceId: p.id, outcome: "success",
        },
      });
      return "updated";
    });
    if (outcome === "missing") {
      throw new NonRetryableError(`KEYWORD_RULE_NOT_FOUND: keyword rule ${p.id} not found`);
    }
    await cache.invalidate(cache.makeKey(p.tenantId, "keyword_rules", "all"));
  });

  /**
   * CR-MKT-06: match the inbound message against the tenant's keyword rules and
   * act on the winner. The auto-reply is published as a normal
   * `notification.send` so it goes through the same consent, DND and
   * suppression checks as any other outbound message.
   */
  q.subscribe<InboundPayload>(COMMANDS.inboundReceived, async (msg) => {
    const p = msg.payload;
    if (typeof p.from !== "string" || typeof p.body !== "string") {
      throw new NonRetryableError("INVALID_INBOUND_PAYLOAD: from and body are required");
    }

    let reply: { body: string; ruleId: string } | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rules = await repo.findEnabledRulesInTx(tx, p.tenantId);
      const plan = planAutoResponse(matchKeywordRule(rules, p.body, p.channel));
      if (plan.kind === "none") return;

      const senderHash = blindIndex(p.from);
      await repo.insertAutoResponse(tx, {
        id: randomUUID(),
        tenantId: p.tenantId,
        ruleId: plan.ruleId,
        channel: p.channel,
        sender: p.from,
        senderHash,
        outcome: plan.kind,
        action: "action" in plan ? plan.action : null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });

      if ("body" in plan && AUTO_REPLY_CHANNELS.has(p.channel)) {
        reply = { body: plan.body, ruleId: plan.ruleId };
      }

      await enqueue(tx, {
        topic: EVENTS.keywordAutoResponded,
        eventType: EVENTS.keywordAutoResponded,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          ruleId: plan.ruleId, channel: p.channel, outcome: plan.kind,
          action: "action" in plan ? plan.action : null,
        },
      });
    });

    if (reply !== null) {
      const planned: { body: string; ruleId: string } = reply;
      // Outside the transaction: publishing inside it would send even if the
      // transaction later rolled back.
      await msgQueuePublishSend(q, msg.tenantId, msg.actorId, msg.correlationId, {
        channel: p.channel,
        recipient: p.from,
        body: planned.body,
      });
      log.info({ ruleId: planned.ruleId, channel: p.channel }, "keyword auto-response queued");
    }
  });

  q.subscribe<HandoffPayload>(COMMANDS.transitionHandoff, async (msg) => {
    const p = msg.payload;
    if (!HANDOFF_ACTIONS.includes(p.action)) {
      throw new NonRetryableError(`INVALID_HANDOFF_ACTION: unknown action "${String(p.action)}"`);
    }
    let rejection: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findHandoffInTx(tx, p.tenantId, p.conversationId);
      const from: HandoffState = existing && isHandoffState(existing.state)
        ? (existing.state as HandoffState)
        : INITIAL_HANDOFF_STATE;

      // Re-validate against the state the route saw. A concurrent transition
      // that already moved the conversation must not be silently overwritten.
      if (p.expectedFromState !== from) {
        rejection = `conversation moved from ${p.expectedFromState} to ${from} before this transition was applied`;
        return;
      }

      const result = applyHandoffTransition(from, {
        action: p.action,
        ...(p.agentId !== undefined ? { agentId: p.agentId } : {}),
      });
      if (!result.ok) {
        rejection = result.message;
        return;
      }

      const assignedAgentId = result.action === "assign_human"
        ? (p.agentId ?? null)
        : result.to === "human_handling"
          ? (existing?.assignedAgentId ?? null)
          : null;

      await repo.upsertHandoff(tx, {
        id: existing?.id ?? randomUUID(),
        tenantId: p.tenantId,
        conversationId: p.conversationId,
        state: result.to,
        assignedAgentId,
        actorId: msg.actorId,
      });
      await repo.insertHandoffAudit(tx, {
        id: p.id,
        tenantId: p.tenantId,
        conversationId: p.conversationId,
        fromState: result.from,
        toState: result.to,
        action: result.action,
        agentId: p.agentId ?? null,
        reason: p.reason ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.handoffStateChanged,
        eventType: EVENTS.handoffStateChanged,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          conversationId: p.conversationId, fromState: result.from, toState: result.to,
          action: result.action, aiPaused: result.aiPaused, agentId: p.agentId ?? null,
        },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "notification", action: `handoff_${result.action}`,
          resourceType: "conversation_handoff", resourceId: p.conversationId,
          outcome: "success", fromState: result.from, toState: result.to,
        },
      });
    });

    if (rejection !== null) {
      throw new NonRetryableError(`INVALID_TRANSITION: ${rejection}`);
    }
    await cache.invalidate(cache.makeKey(p.tenantId, "handoff", p.conversationId));
  });
}

/** Publish an outbound auto-reply through the shared send command. */
async function msgQueuePublishSend(
  q: Queue, tenantId: string, actorId: string, correlationId: string,
  payload: { channel: string; recipient: string; body: string },
): Promise<void> {
  await q.publish(COMMANDS.sendNotification, {
    messageId: randomUUID(),
    type: COMMANDS.sendNotification,
    tenantId,
    actorId,
    correlationId,
    schemaVersion: "1.0",
    payload,
  });
}
