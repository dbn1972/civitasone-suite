/**
 * GAP-LEGAL-HEARINGS-05 (owner decision #8): reminder dispatcher.
 *
 * Every 5 minutes, find case reminders whose remind_at has passed and that have
 * not been sent, and send them through notification-service (`notification.send`
 * via the transactional outbox). Recipient = the case's assigned officer(s); the
 * reminder's creator is cc'd (a separate send tagged role=cc, because
 * notification-service has no native cc). When a case has no assigned officer the
 * creator is the sole recipient (no duplicate cc).
 *
 * Exactly-once: the guarded `UPDATE ... SET sent = true WHERE sent = false` and
 * the outbox rows (notification + audit) commit in ONE transaction, so a crash
 * either leaves the reminder unsent (picked up next sweep) or sent with its
 * notifications queued. Two overlapping sweepers cannot both flip the row.
 *
 * Cross-tenant discovery uses the SELECT-only BYPASSRLS scanner pool (migration
 * 0031 grants it SELECT on reminders.legal_reminders); every write runs under the
 * reminder's own tenant context on the normal pool so FORCE RLS re-checks it.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, lte } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { buildNotificationPayload, NOTIFICATION_SEND } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { scannerDb } from "../../shared/scanner-db.js";
import { enqueue } from "../../shared/outbox.js";
import { legalReminders } from "./schema.js";
import * as caseRepo from "../cases/repo.js";

export const DISPATCH_INTERVAL_MS = 5 * 60_000;
const BATCH = 200;
const AUDIT_TOPIC = "audit.event.record";

let busy = false;

export interface SweepResult { dispatched: number; skipped: number; failed: number }

export async function sweepDueReminders(now: Date = new Date()): Promise<SweepResult> {
  if (busy) return { dispatched: 0, skipped: 0, failed: 0 };
  busy = true;
  try {
    // Discovery only (ids): the cross-tenant read goes through the scanner role.
    const due = await scannerDb
      .select({ id: legalReminders.id, tenantId: legalReminders.tenantId })
      .from(legalReminders)
      .where(and(eq(legalReminders.sent, false), lte(legalReminders.remindAt, now)))
      .orderBy(asc(legalReminders.remindAt))
      .limit(BATCH);

    const out: SweepResult = { dispatched: 0, skipped: 0, failed: 0 };
    for (const r of due) {
      try {
        const sent = await runWithTenant(r.tenantId, () => dispatchOne(r.tenantId, r.id, now));
        if (sent) out.dispatched++; else out.skipped++;
      } catch (err) {
        out.failed++;
        // eslint-disable-next-line no-console -- worker log; a failed row is retried on the next sweep
        console.error("[legal-reminder-dispatch] reminder failed:", r.id, err instanceof Error ? err.message : err);
      }
    }
    return out;
  } finally {
    busy = false;
  }
}

async function dispatchOne(tenantId: string, reminderId: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Guarded write: only one sweeper can flip an unsent, due reminder.
    const flipped = await tx.update(legalReminders)
      .set({ sent: true, sentAt: now, updatedAt: now })
      .where(and(
        eq(legalReminders.id, reminderId),
        eq(legalReminders.tenantId, tenantId),
        eq(legalReminders.sent, false),
        lte(legalReminders.remindAt, now),
      ))
      .returning();
    const reminder = flipped[0];
    if (!reminder) return false;

    const legalCase = await caseRepo.findCaseByIdTx(tx, reminder.caseId);
    const officers = [...new Set(legalCase?.assignedOfficerIds ?? [])];
    const recipients: Array<{ id: string; role: "to" | "cc" }> =
      officers.length > 0
        ? officers.map((id) => ({ id, role: "to" as const }))
        : [{ id: reminder.createdBy, role: "to" as const }];
    if (officers.length > 0 && !officers.includes(reminder.createdBy)) {
      recipients.push({ id: reminder.createdBy, role: "cc" });
    }

    const correlationId = randomUUID();
    for (const rcp of recipients) {
      await enqueue(tx, {
        topic: NOTIFICATION_SEND,
        eventType: "legal.reminder.due",
        tenantId,
        actorId: reminder.createdBy,
        correlationId,
        payload: buildNotificationPayload({
          eventType: "legal.reminder.due",
          recipient: rcp.id,
          recipientId: rcp.id,
          channel: "in_app",
          variables: {
            role: rcp.role,
            reminderId: reminder.id,
            caseId: reminder.caseId,
            caseNo: legalCase?.caseNo ?? "",
            caseTitle: legalCase?.title ?? "",
            message: reminder.message,
            remindAt: reminder.remindAt.toISOString(),
          },
        }),
      });
    }
    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: "legal.reminder.dispatched",
      tenantId,
      actorId: reminder.createdBy,
      correlationId,
      payload: {
        service: "legal", action: "dispatch", resourceType: "reminder", resourceId: reminder.id,
        outcome: "success",
        newValue: { caseId: reminder.caseId, to: recipients.filter((x) => x.role === "to").map((x) => x.id), cc: recipients.filter((x) => x.role === "cc").map((x) => x.id) },
      },
    });
    return true;
  });
}

/** Starts the 5-minute sweep. Returns stop(). Runs once immediately. */
export function startReminderDispatcher(): () => void {
  const run = () => { void sweepDueReminders().catch((err) => {
    // eslint-disable-next-line no-console -- worker log
    console.error("[legal-reminder-dispatch] sweep failed:", err instanceof Error ? err.message : err);
  }); };
  run();
  const timer = setInterval(run, DISPATCH_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
