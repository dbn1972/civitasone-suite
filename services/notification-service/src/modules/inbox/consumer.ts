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
 *
 * P1-6: a rule whose action means "opt out" now WITHDRAWS CONSENT instead of only
 * being written to `inbound_auto_responses.action` as text. Before this, a
 * recipient who replied STOP was told they had been unsubscribed, the string
 * "opt_out" was stored, an event was emitted that nothing consumed — and the next
 * marketing send to them was still delivered, because no code path had ever
 * turned an inbound message into a recorded refusal.
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { blindIndex } from "../../shared/pii-crypto.js";
import { isOptOutAction, matchKeywordRule, planAutoResponse, type MatchType } from "./keyword-domain.js";
import {
  applyHandoffTransition,
  isHandoffState,
  INITIAL_HANDOFF_STATE,
  HANDOFF_ACTIONS,
  type HandoffAction,
  type HandoffState,
} from "./handoff-domain.js";
import * as repo from "./keyword-repo.js";
import * as correlationRepo from "./correlation-repo.js";
/**
 * P1-6: the opt-out is recorded on `bounces.suppression_list` because that is the
 * ONE consent signal the send gate reads by recipient ADDRESS. `templates.prefs`
 * is keyed by `user_id uuid` and an inbound SMS carries only a phone number, so a
 * pref row can never be located for it (`asUserUuid()` resolves a non-uuid to
 * null and the gate then loads no prefs at all). Same cross-module boundary the
 * send path itself already crosses in `deliveries/consent-gate-io.ts`, for the
 * same reason and with the same table.
 */
import * as suppressionRepo from "../bounces/repo.js";

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

type CorrelatePayload = {
  id: string; tenantId: string; conversationId: string; ticketId: string;
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
   *
   * CH-07: additionally, attempt CRM contact lookup. When unmatched or ambiguous,
   * insert into `inbound_review_queue` so operators can manually link the sender.
   */
  q.subscribe<InboundPayload>(COMMANDS.inboundReceived, async (msg) => {
    const p = msg.payload;
    if (typeof p.from !== "string" || typeof p.body !== "string") {
      throw new NonRetryableError("INVALID_INBOUND_PAYLOAD: from and body are required");
    }

    // CH-07: CRM contact lookup via HTTP — fail open (no blocking on CRM downtime)
    let crmMatched = false;
    try {
      const CRM_BASE = process.env.CRM_SERVICE_URL ?? "http://localhost:3024";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      const lookupRes = await fetch(`${CRM_BASE}/v1/crm/contacts?phone=${encodeURIComponent(p.from)}&limit=2`, {
        signal: controller.signal,
        headers: { "x-tenant-id": p.tenantId, "x-internal": "true" },
      });
      clearTimeout(timeout);
      if (lookupRes.ok) {
        const lookupJson = await lookupRes.json() as { data?: Array<{ id: string }> };
        const matches = lookupJson.data ?? [];
        if (matches.length === 1) {
          crmMatched = true;
        } else {
          // 0 matches or 2+ (ambiguous) → insert into review queue
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              INSERT INTO notification.inbound_review_queue
                (id, tenant_id, channel, sender_identifier, message_content, status)
              VALUES (${randomUUID()}, ${p.tenantId}, ${p.channel}, ${p.from}, ${p.body.substring(0, 500)}, 'pending')
            `);
          });
          // Emit review_needed event
          await db.transaction(async (tx) => {
            await enqueue(tx, {
              topic: EVENTS.contactReviewNeeded,
              eventType: EVENTS.contactReviewNeeded,
              tenantId: p.tenantId,
              actorId: msg.actorId,
              correlationId: msg.correlationId,
              payload: {
                channel: p.channel,
                senderIdentifier: p.from,
                matchCount: matches.length,
              },
            });
          });
          log.info({ channel: p.channel, matchCount: matches.length }, "inbound contact unmatched - queued for review");
        }
      }
    } catch {
      // CRM service unavailable — fail open, proceed with keyword matching
      log.warn({ channel: p.channel }, "CRM contact lookup failed - proceeding without match");
    }
    void crmMatched; // Used for future correlation; presence documents the lookup outcome

    let reply: { body: string; ruleId: string } | null = null;
    let optedOut = false;
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

      // P1-6: apply the consent withdrawal in the SAME transaction as the
      // auto-response row. Doing it asynchronously would leave a window in which
      // a campaign fan-out still saw the sender as consenting, and a consent
      // decision that is only eventually applied is a consent decision that can
      // be missed. Idempotent: `upsertSuppression` conflicts on
      // (tenant_id, recipient_hash), so a resent STOP refreshes one row.
      if ("action" in plan && isOptOutAction(plan.action)) {
        await suppressionRepo.upsertSuppression(tx, {
          tenantId: p.tenantId,
          recipient: p.from,        // PII — encrypted by the column type
          recipientHash: senderHash,
          channel: p.channel,
          reason: "unsubscribe",
          source: "inbound",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
        optedOut = true;
        await enqueue(tx, {
          topic: EVENTS.consentOptedOut,
          eventType: EVENTS.consentOptedOut,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            ruleId: plan.ruleId, channel: p.channel,
            reason: "unsubscribe", source: "inbound", recipientHash: senderHash,
          },
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: p.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "notification", action: "opt_out", resourceType: "suppression",
            // The blind index, not the address: stable across a repeated STOP
            // (the upsert keeps the original row id) and not reversible.
            resourceId: senderHash,
            outcome: "success", channel: p.channel, reason: "unsubscribe",
            source: "inbound", ruleId: plan.ruleId,
          },
        });
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
    if (optedOut) {
      // No sender address in the log line — the blind index identifies the row.
      log.info(
        { channel: p.channel, recipientHash: blindIndex(p.from) },
        "inbound opt-out recorded - recipient suppressed",
      );
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

  /**
   * INT-04: `notification.inbox.correlate` was published by
   * correlation-routes.ts with nothing subscribed to it — the POST always
   * returned 202, but the ticketId was never persisted, so the GET on the
   * same route file could never find a row. Consumed here (inbox owns the
   * conversation) by writing to notification.inbox_correlations, the exact
   * table the GET already reads from (migration 0025).
   *
   * Idempotent two ways: `markProcessed` on the message id short-circuits a
   * redelivery of the same command, and `upsertCorrelation` conflicts on
   * (tenant_id, conversation_id) — the unique index from migration 0025 — so
   * a second correlate call for the same conversation updates the linked
   * ticket instead of erroring or duplicating a row.
   */
  q.subscribe<CorrelatePayload>(COMMANDS.correlateInbox, async (msg) => {
    const p = msg.payload;
    if (typeof p.conversationId !== "string" || typeof p.ticketId !== "string") {
      throw new NonRetryableError("INVALID_CORRELATE_PAYLOAD: conversationId and ticketId are required");
    }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await correlationRepo.upsertCorrelation(tx, {
        id: p.id,
        tenantId: p.tenantId,
        conversationId: p.conversationId,
        ticketId: p.ticketId,
      });
      await enqueue(tx, {
        topic: EVENTS.inboxCorrelated,
        eventType: EVENTS.inboxCorrelated,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { conversationId: p.conversationId, ticketId: p.ticketId },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "notification", action: "correlate_inbox", resourceType: "inbox_correlation",
          resourceId: p.conversationId, outcome: "success", ticketId: p.ticketId,
        },
      });
    });
    // Same cache key format the GET route in correlation-routes.ts reads/writes.
    await cache.invalidate(`notification:${p.tenantId}:correlation:${p.conversationId}`);
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
