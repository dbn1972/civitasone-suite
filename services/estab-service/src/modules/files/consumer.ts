import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerFilesConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.fileCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; fileNo: string; subject: string; dept: string; priority: string; classification: string; currentWith: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertFile(tx, {
        id: p.id, tenantId: p.tenantId, fileNo: p.fileNo, subject: p.subject,
        dept: p.dept, priority: p.priority, classification: p.classification,
        currentWith: p.currentWith, status: "draft",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.fileCreated, eventType: EVENTS.fileCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { fileId: p.id, fileNo: p.fileNo, subject: p.subject },
      });
      await audit(tx, msg, "create", "file", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.id));
  });

  queue.subscribe(COMMANDS.notingAdd, async (msg) => {
    const p = msg.payload as { id: string; fileId: string; tenantId: string; body: string; action?: string; officerId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const seq = (await repo.countNotings(tx, p.fileId)) + 1;
      await repo.insertNoting(tx, {
        id: p.id, tenantId: p.tenantId, fileId: p.fileId, seq,
        officerId: p.officerId, body: p.body, action: p.action ?? null,
        eSigned: false, signedAt: null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "add", "noting", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(COMMANDS.fileMove, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; toOfficer: string; remarks?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateFile(tx, p.fileId, { currentWith: p.toOfficer, status: "active", updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.fileMoved, eventType: EVENTS.fileMoved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { fileId: p.fileId, toOfficer: p.toOfficer, remarks: p.remarks ?? "" },
      });
      await audit(tx, msg, "move", "file", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(COMMANDS.fileClose, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; remarks?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateFile(tx, p.fileId, { status: "closed", updatedBy: msg.actorId });
      await audit(tx, msg, "close", "file", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(COMMANDS.dispatchCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; dispatchNo: string; fileId?: string; toAddress: string; mode: string; subject: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertDispatch(tx, {
        id: p.id, tenantId: p.tenantId, dispatchNo: p.dispatchNo,
        fileId: p.fileId ?? null, toAddress: p.toAddress, mode: p.mode, subject: p.subject,
        dispatchedAt: new Date(), status: "sent",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "dispatch", p.id);
    });
  });

  queue.subscribe(COMMANDS.inwardRegister, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; dakNo: string; fromAddress: string; subject: string; assignedTo?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertInward(tx, {
        id: p.id, tenantId: p.tenantId, dakNo: p.dakNo,
        fromAddress: p.fromAddress, subject: p.subject,
        assignedTo: p.assignedTo ?? null, fileRef: null, status: "received",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "register", "inward", p.id);
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}
