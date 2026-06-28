import { randomUUID, createHash } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import { computeFileDueBy } from "./domain.js";
import * as repo from "./repo.js";
import { emitModuleDecisionCallback } from "../linkage/consumer.js";

const AUDIT_TOPIC = "audit.event.record";
const WORKFLOW_CREATE = "workflow.instance.create";
const FILE_NOTING_WORKFLOW = "file_noting";

export function registerFilesConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.fileCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; fileNo: string; subject: string; dept: string;
      priority: string; classification: string; currentWith: string;
      initialNote?: string; inwardId?: string; dakNo?: string; parentFileId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const dueBy = computeFileDueBy();
      await repo.insertFile(tx, {
        id: p.id, tenantId: p.tenantId, fileNo: p.fileNo, subject: p.subject,
        dept: p.dept, priority: p.priority, classification: p.classification,
        currentWith: p.currentWith, status: "draft",
        inwardId: p.inwardId ?? null, dakNo: p.dakNo ?? null, dueBy,
        parentFileId: p.parentFileId ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (p.inwardId) {
        await repo.updateInward(tx, p.inwardId, {
          fileId: p.id, fileRef: p.fileNo, status: "file_opened", updatedBy: msg.actorId,
        });
      }
      if (p.initialNote?.trim()) {
        const noteId = randomUUID();
        await repo.insertNoting(tx, {
          id: noteId, tenantId: p.tenantId, fileId: p.id, seq: 1,
          officerId: p.currentWith, body: p.initialNote.trim(),
          action: "initiate", noteType: "yellow", noteStatus: "draft",
          eSigned: false, signedAt: null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
      }
      await enqueue(tx, {
        topic: EVENTS.fileCreated, eventType: EVENTS.fileCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { fileId: p.id, fileNo: p.fileNo, subject: p.subject, dakNo: p.dakNo },
      });
      await audit(tx, msg, "create", "file", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.id));
  });

  queue.subscribe(COMMANDS.inwardOpenFile, async (msg) => {
    const p = msg.payload as {
      id: string; inwardId: string; tenantId: string; fileNo: string;
      dept: string; currentWith: string; classification: string; initialNote?: string;
    };
    const inward = await repo.findInwardById(p.inwardId, p.tenantId);
    if (!inward) return;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const dueBy = computeFileDueBy();
      await repo.insertFile(tx, {
        id: p.id, tenantId: p.tenantId, fileNo: p.fileNo,
        subject: inward.subject, dept: p.dept, priority: "normal",
        classification: p.classification, currentWith: p.currentWith,
        status: "draft", inwardId: p.inwardId, dakNo: inward.dakNo, dueBy,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateInward(tx, p.inwardId, {
        fileId: p.id, fileRef: p.fileNo, status: "file_opened", updatedBy: msg.actorId,
      });
      const noteBody = p.initialNote?.trim() ?? `DAK ${inward.dakNo} registered and file opened.`;
      await repo.insertNoting(tx, {
        id: randomUUID(), tenantId: p.tenantId, fileId: p.id, seq: 1,
        officerId: p.currentWith, body: noteBody,
        action: "dak_to_file", noteType: "yellow", noteStatus: "draft",
        eSigned: false, signedAt: null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.fileCreated, eventType: EVENTS.fileCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { fileId: p.id, fileNo: p.fileNo, inwardId: p.inwardId, dakNo: inward.dakNo },
      });
      await audit(tx, msg, "open_from_dak", "file", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.id));
  });

  queue.subscribe(COMMANDS.notingAdd, async (msg) => {
    const p = msg.payload as {
      id: string; fileId: string; tenantId: string; body: string;
      action?: string; officerId: string; noteType?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findFileById(p.fileId, p.tenantId);
      if (existing?.status === "closed") {
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "estab", action: "noting_rejected_closed_file", resourceType: "file", resourceId: p.fileId, outcome: "rejected" },
        });
        return;
      }
      const seq = (await repo.countNotings(tx, p.fileId)) + 1;
      await repo.insertNoting(tx, {
        id: p.id, tenantId: p.tenantId, fileId: p.fileId, seq,
        officerId: p.officerId, body: p.body, action: p.action ?? null,
        noteType: p.noteType ?? "yellow", noteStatus: "draft",
        eSigned: false, signedAt: null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "add", "noting", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(COMMANDS.notingSubmit, async (msg) => {
    const p = msg.payload as { fileId: string; notingId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const noting = await repo.findNotingById(p.notingId, p.tenantId);
      if (!noting || noting.fileId !== p.fileId || noting.noteStatus !== "draft") return;

      await repo.updateNoting(tx, p.notingId, {
        noteStatus: "submitted", updatedBy: msg.actorId,
      });
      await repo.updateFile(tx, p.fileId, { status: "active", updatedBy: msg.actorId });

      const wfId = randomUUID();
      await enqueue(tx, {
        topic: WORKFLOW_CREATE, eventType: WORKFLOW_CREATE,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: wfId,
          tenantId: msg.tenantId,
          name: `File Noting — ${p.fileId.slice(0, 8)}`,
          status: "active",
          definitionCode: FILE_NOTING_WORKFLOW,
          startNodeKey: "section_review",
          initialTaskName: "Section Officer Review",
          version: 1,
          refType: "estab_file",
          refId: p.fileId,
        },
      });
      await audit(tx, msg, "submit_for_approval", "noting", p.notingId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(CONSUMED_EVENTS.fileApprove, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; approvedBy: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const noting = await repo.findLatestSubmittedNoting(tx, p.fileId, p.tenantId);
      if (noting) {
        const signatureRef = `DSC-${p.approvedBy.slice(0, 8)}-${Date.now()}`;
        const dscHash = createHash("sha256")
          .update(`${noting.id}:${noting.body}:${p.approvedBy}:${Date.now()}`)
          .digest("hex");
        await repo.updateNoting(tx, noting.id, {
          noteType: "green",
          noteStatus: "approved",
          eSigned: true,
          signedAt: new Date(),
          signatureRef,
          dscHash,
          updatedBy: p.approvedBy,
        });
      }
      await repo.updateFile(tx, p.fileId, { status: "active", updatedBy: p.approvedBy });
      await enqueue(tx, {
        topic: EVENTS.fileMoved, eventType: EVENTS.fileMoved,
        tenantId: msg.tenantId, actorId: p.approvedBy, correlationId: msg.correlationId,
        payload: { fileId: p.fileId, action: "noting_approved", approvedBy: p.approvedBy },
      });
      // Cross-module: if this file was raised by a source module, send the
      // approved decision back so the module can execute (release budget, etc.)
      const approvedNoting = await repo.findLatestSubmittedNoting(tx, p.fileId, p.tenantId);
      await emitModuleDecisionCallback(tx, {
        tenantId: p.tenantId, fileId: p.fileId, correlationId: msg.correlationId,
        decision: "approved", decidedBy: p.approvedBy,
        notingId: approvedNoting?.id ?? null,
        dscHash: approvedNoting?.dscHash ?? null,
      });
      await audit(tx, msg, "approve", "file", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(CONSUMED_EVENTS.fileReject, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; rejectedBy: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const noting = await repo.findLatestSubmittedNoting(tx, p.fileId, p.tenantId);
      if (noting) {
        await repo.updateNoting(tx, noting.id, {
          noteStatus: "rejected",
          updatedBy: p.rejectedBy,
        });
      }
      await repo.updateFile(tx, p.fileId, { status: "draft", updatedBy: p.rejectedBy });
      await enqueue(tx, {
        topic: EVENTS.fileMoved, eventType: EVENTS.fileMoved,
        tenantId: msg.tenantId, actorId: p.rejectedBy, correlationId: msg.correlationId,
        payload: { fileId: p.fileId, action: "noting_rejected", rejectedBy: p.rejectedBy },
      });
      // Cross-module: send the rejected decision back to the source module
      await emitModuleDecisionCallback(tx, {
        tenantId: p.tenantId, fileId: p.fileId, correlationId: msg.correlationId,
        decision: "rejected", decidedBy: p.rejectedBy,
      });
      await audit(tx, msg, "reject", "file", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });

  queue.subscribe(COMMANDS.fileMove, async (msg) => {
    const p = msg.payload as { fileId: string; tenantId: string; toOfficer: string; remarks?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findFileById(p.fileId, p.tenantId);
      if (existing?.status === "closed") {
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "estab", action: "move_rejected_closed_file", resourceType: "file", resourceId: p.fileId, outcome: "rejected" },
        });
        return;
      }
      await repo.insertFileMovement(tx, {
        id: randomUUID(), tenantId: p.tenantId, fileId: p.fileId,
        fromOfficerId: existing?.currentWith ?? null,
        toOfficerId: p.toOfficer, action: "forward", remarks: p.remarks ?? null,
      });
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
    const p = msg.payload as {
      id: string; tenantId: string; dakNo: string; fromAddress: string; subject: string;
      assignedTo?: string; sourceSection?: string;
    };
    const barcode = `DAK-${p.dakNo.replace(/\//g, "-")}`;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertInward(tx, {
        id: p.id, tenantId: p.tenantId, dakNo: p.dakNo,
        fromAddress: p.fromAddress, subject: p.subject,
        assignedTo: p.assignedTo ?? null, fileRef: null, fileId: null,
        barcode, sourceSection: p.sourceSection ?? null,
        status: "received",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "register", "inward", p.id);
    });
  });

  queue.subscribe(COMMANDS.fileAttachmentAdd, async (msg) => {
    const p = msg.payload as {
      id: string; fileId: string; tenantId: string; fileName: string;
      fileType: string; sizeBytes: number; storageRef?: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAttachment(tx, {
        id: p.id, tenantId: p.tenantId, fileId: p.fileId,
        fileName: p.fileName, fileType: p.fileType, sizeBytes: p.sizeBytes,
        storageRef: p.storageRef ?? null,
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "add_attachment", "file", p.fileId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.fileId));
  });
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}
