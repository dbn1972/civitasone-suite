import { randomUUID } from "node:crypto";
import { db } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { legalHearings } from "../modules/hearings/schema.js";
import { legalCases } from "../modules/cases/schema.js";
import { and, lte, isNull, eq, gte } from "drizzle-orm";

const NOTIFICATION_TOPIC = "notification.send";

export function startHearingReminderCron(): void {
  const run = async () => {
    try {
      const now = new Date();
      const in7Days = new Date(Date.now() + 7 * 86400000);
      const nowDate = now.toISOString().slice(0, 10);
      const in7Date = in7Days.toISOString().slice(0, 10);

      const upcoming = await db.select().from(legalHearings).where(and(
        gte(legalHearings.hearingDate, nowDate),
        lte(legalHearings.hearingDate, in7Date),
        isNull(legalHearings.reminderSentAt),
        eq(legalHearings.status, "scheduled"),
      ));

      for (const h of upcoming) {
        const recipientId = h.assignedTo ?? h.createdBy;
        await queue.publish(NOTIFICATION_TOPIC, {
          messageId: randomUUID(),
          type: NOTIFICATION_TOPIC,
          tenantId: h.tenantId,
          actorId: recipientId,
          correlationId: randomUUID(),
          schemaVersion: "1.0",
          payload: {
            type: "legal_hearing_reminder",
            recipientId,
            hearingId: h.id,
            hearingDate: String(h.hearingDate),
          },
        });
        await db.update(legalHearings)
          .set({ reminderSentAt: new Date() })
          .where(eq(legalHearings.id, h.id));
      }

      const overdue = await db.select().from(legalHearings).where(and(
        lte(legalHearings.hearingDate, nowDate),
        eq(legalHearings.status, "scheduled"),
      ));

      for (const h of overdue) {
        await db.update(legalCases)
          .set({ status: "defaulted", updatedAt: new Date() })
          .where(eq(legalCases.id, h.caseId));
      }
    } catch (err) {
      // eslint-disable-next-line no-console -- cron error logging to stderr
      console.error("[legal-cron] hearing reminder failed:", err);
    }
  };

  // Run at startup, then daily at 08:00 UTC
  void run();
  const scheduleDailyUtc = () => {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 8, 0, 0));
    const delay = next.getTime() - now.getTime();
    setTimeout(() => {
      void run();
      setInterval(run, 24 * 60 * 60 * 1000);
    }, delay);
  };
  scheduleDailyUtc();
}
