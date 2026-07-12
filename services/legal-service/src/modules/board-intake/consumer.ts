import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Cross-service choreography (action side) — board decision → legal intake.
 *
 * meeting-service publishes `meeting.decision.legal` ({ decisionId, meetingId,
 * text, authority?, committeeId? }) when a board records a free-text legal
 * decision. This consumer opens a PENDING_REVIEW intake item so a competent
 * legal officer can triage it and action it through the service's own controlled
 * flow. It NEVER auto-creates a legal matter.
 *
 * Idempotent on two levels: markProcessed (messageId inbox) drops duplicate
 * deliveries, and the (tenant_id, decision_id) unique index drops re-published
 * decisions arriving under a fresh messageId.
 */
export function registerBoardIntakeConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.boardDecisionLegal, async (msg) => {
    const p = msg.payload as {
      decisionId?: string; meetingId?: string; text?: string;
      committeeId?: string; authority?: string; effectiveDate?: string;
    };
    if (!p?.decisionId || !p?.meetingId || !p?.text) return;

    await runWithTenant(msg.tenantId, async () => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const created = await repo.insertIntakeIdempotent(tx, {
          id: randomUUID(),
          tenantId: msg.tenantId,
          source: "meeting",
          decisionId: p.decisionId!,
          meetingId: p.meetingId!,
          committeeId: p.committeeId ?? null,
          text: p.text!,
          authority: p.authority ?? null,
          effectiveDate: p.effectiveDate ?? null,
          status: "pending_review",
        });
        if (!created) return; // replay: an intake already exists for (tenant, decision)
        await audit(tx, msg, "intake_open", p.decisionId!, {
          meetingId: p.meetingId,
          ...(p.authority ? { authority: p.authority } : {}),
        });
      });
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "board_decision_intake", "pending"));
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType: "board_decision_intake", resourceId, outcome: "success", metadata },
  });
}
