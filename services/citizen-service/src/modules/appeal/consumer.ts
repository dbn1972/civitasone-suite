import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { orderOutcome } from "./domain.js";

const AUDIT = "audit.event.record";

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType: "appeal", resourceId, outcome: "success" },
  });
}

export function registerAppealConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.appealFile, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; applicationId: string | null; decisionRef: string | null;
      citizenId: string | null; appealType: string; grounds: string;
      decisionDate: string; filingDeadline: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAppeal(tx, {
        id: p.id, tenantId: p.tenantId, applicationId: p.applicationId,
        decisionRef: p.decisionRef, citizenId: p.citizenId,
        appealType: p.appealType, grounds: p.grounds,
        decisionDate: p.decisionDate, filingDeadline: p.filingDeadline, status: "filed",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.appealFiled, eventType: EVENTS.appealFiled,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, applicationId: p.applicationId, appealType: p.appealType },
      });
      await audit(tx, msg, "file", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "appeal", p.id));
  });

  queue.subscribe(COMMANDS.appealAssign, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; appellateAuthorityId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ap = await repo.findAppealByIdTx(tx, p.id, msg.tenantId);
      if (!ap || ap.status !== "filed") return;
      await repo.updateAppeal(tx, p.id, msg.tenantId, {
        appellateAuthorityId: p.appellateAuthorityId, status: "assigned", updatedBy: msg.actorId,
      });
      await audit(tx, msg, "assign", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "appeal", p.id));
  });

  queue.subscribe(COMMANDS.appealTransferRecords, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ap = await repo.findAppealByIdTx(tx, p.id, msg.tenantId);
      if (!ap || !ap.appellateAuthorityId) return;
      await repo.updateAppeal(tx, p.id, msg.tenantId, {
        recordsTransferred: true, recordsTransferredAt: new Date(), updatedBy: msg.actorId,
      });
      await audit(tx, msg, "transfer_records", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "appeal", p.id));
  });

  queue.subscribe(COMMANDS.appealScheduleHearing, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; hearingId: string; scheduledAt?: string; mode: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ap = await repo.findAppealByIdTx(tx, p.id, msg.tenantId);
      if (!ap) return;
      await repo.insertHearing(tx, {
        id: p.hearingId, tenantId: p.tenantId, appealId: p.id,
        scheduledAt: p.scheduledAt ? new Date(p.scheduledAt) : null, mode: p.mode,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (ap.status !== "hearing") {
        await repo.updateAppeal(tx, p.id, msg.tenantId, { status: "hearing", updatedBy: msg.actorId });
      }
      await audit(tx, msg, "schedule_hearing", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "appeal", p.id));
  });

  queue.subscribe(COMMANDS.appealRecordHearing, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; hearingId: string; record: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ap = await repo.findAppealByIdTx(tx, p.id, msg.tenantId);
      if (!ap) return;
      const hearings = await repo.listHearingsTx(tx, msg.tenantId, p.id);
      if (!hearings.some((x) => x.id === p.hearingId)) return;
      await repo.updateHearing(tx, p.hearingId, msg.tenantId, {
        record: p.record, heldAt: new Date(), updatedBy: msg.actorId,
      });
      await audit(tx, msg, "record_hearing", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "appeal", p.id));
  });

  queue.subscribe(COMMANDS.appealPrepareOrder, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; orderType: string; orderNote?: string; remandTo?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ap = await repo.findAppealByIdTx(tx, p.id, msg.tenantId);
      if (!ap) return;
      await repo.updateAppeal(tx, p.id, msg.tenantId, {
        orderType: p.orderType, orderNote: p.orderNote ?? null, remandTo: p.remandTo ?? null,
        preparedBy: msg.actorId, preparedAt: new Date(), updatedBy: msg.actorId,
      });
      await audit(tx, msg, "prepare_order", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "appeal", p.id));
  });

  queue.subscribe(COMMANDS.appealIssueOrder, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ap = await repo.findAppealByIdTx(tx, p.id, msg.tenantId);
      if (!ap || !ap.orderType || !ap.preparedBy) return;
      if (ap.preparedBy === msg.actorId) return;
      if (ap.status === "decided" || ap.status === "remanded" || ap.status === "closed") return;
      const { status, outcome } = orderOutcome(ap.orderType as "upheld" | "overturned" | "modified" | "remanded");
      await repo.updateAppeal(tx, p.id, msg.tenantId, {
        status, outcome, decidedBy: msg.actorId, decidedAt: new Date(), updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.appealDecided, eventType: EVENTS.appealDecided,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, applicationId: ap.applicationId, orderType: ap.orderType, outcome, remandTo: ap.remandTo },
      });
      if (ap.citizenId) {
        await enqueue(tx, {
          topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.appealDecided,
            recipient: ap.citizenId, recipientId: ap.citizenId,
            variables: { appealId: p.id, outcome },
          }) as unknown as Record<string, unknown>,
        });
      }
      await audit(tx, msg, "issue_order", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "appeal", p.id));
  });
}
