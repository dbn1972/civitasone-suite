import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertCanRespond } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerNoticeConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.noticeCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; noticeNo: string; subject: string;
      partyRef: string; direction: "sent" | "received";
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertNotice(tx, {
        id: p.id, tenantId: p.tenantId, noticeNo: p.noticeNo, subject: p.subject,
        partyRef: p.partyRef, direction: p.direction, status: "open",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "notice", p.id);
    });
  });

  queue.subscribe(COMMANDS.noticeRespond, async (msg) => {
    const p = msg.payload as { noticeId: string; tenantId: string; responseBody: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const notice = await repo.findNoticeByIdTx(tx, p.noticeId);
      if (!notice) throw new Error(`notice ${p.noticeId} not found`);
      assertCanRespond(notice.status ?? "open");
      await repo.insertNoticeResponse(tx, {
        id: randomUUID(), tenantId: p.tenantId, noticeId: p.noticeId,
        responseBody: p.responseBody, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateNotice(tx, p.noticeId, { status: "responded", updatedBy: msg.actorId, version: (notice.version ?? 1) + 1 });
      await audit(tx, msg, "respond", "notice", p.noticeId);
    });
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType, resourceId, outcome: "success" },
  });
}
