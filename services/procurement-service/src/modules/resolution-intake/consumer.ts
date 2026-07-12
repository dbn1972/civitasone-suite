/**
 * Resolution Indent Intake — consumer for `meeting.decision.procurement` (Req 22.1).
 *
 * Cross-service choreography: when a board/committee records a procurement decision,
 * meeting-service emits `meeting.decision.procurement`. This consumer opens a PENDING
 * REVIEW item; it does NOT create a real indent (GFR / maker-checker preserved).
 *
 * Mandatory order (steering: Concurrency & Data Integrity):
 *   1. runWithTenant(msg.tenantId) so RLS (SET LOCAL app.tenant_id) is enforced.
 *   2. markProcessed(tx, messageId) FIRST — a redelivered messageId is a no-op.
 *   3. IDEMPOTENT insert deduped on (tenant_id, decision_id) — a replayed decision
 *      (different messageId, same decisionId) must not create a second intake.
 *   4. audit.event.record for the intake creation.
 */
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import { procurementResolutionIndentIntake as t } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "procurement:resolution-intake-consumer" });

/** Payload contract guaranteed by meeting-service (topics.ts decisionProcurement). */
interface ProcurementDecisionPayload {
  decisionId: string;
  meetingId: string;
  text: string;
  authority?: string;
  effectiveDate?: string;
  /** Not currently emitted by meeting-service; tolerated if added later. */
  committeeId?: string;
}

export function registerResolutionIntakeConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.meetingDecisionProcurement, async (msg) => {
    const p = msg.payload as ProcurementDecisionPayload;
    if (!p || !p.decisionId) return; // malformed — drop (envelope/audit records the miss)

    await runWithTenant(msg.tenantId, async () => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return; // duplicate delivery

        const inserted = await tx
          .insert(t)
          .values({
            tenantId: msg.tenantId,
            source: "meeting",
            decisionId: p.decisionId,
            meetingId: p.meetingId ?? null,
            committeeId: p.committeeId ?? null,
            title: p.text ? p.text.slice(0, 120) : null,
            text: p.text ?? "",
            authority: p.authority ?? null,
            effectiveDate: p.effectiveDate ? p.effectiveDate.slice(0, 10) : null,
            status: "pending_review",
          })
          .onConflictDoNothing({ target: [t.tenantId, t.decisionId] })
          .returning({ id: t.id });

        if (inserted.length === 0) {
          log.info({ tenantId: msg.tenantId, decisionId: p.decisionId }, "duplicate board procurement resolution — intake already exists");
          return;
        }

        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "procurement",
            action: "resolution_indent_intake_created",
            resourceType: "procurement_resolution_indent_intake",
            resourceId: inserted[0]!.id,
            outcome: "success",
            metadata: { decisionId: p.decisionId, meetingId: p.meetingId ?? null },
          },
        });

        log.info(
          { tenantId: msg.tenantId, decisionId: p.decisionId, intakeId: inserted[0]!.id },
          "board procurement resolution -> pending indent intake",
        );
      });
    });
  });
}
