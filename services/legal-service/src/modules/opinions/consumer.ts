import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertCanDraft, assertCanIssue } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerOpinionConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.opinionSeek, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; opinionNo: string; subject: string;
      question: string; caseId?: string; soughtBy?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertOpinion(tx, {
        id: p.id, tenantId: p.tenantId, opinionNo: p.opinionNo, subject: p.subject,
        question: p.question, caseId: p.caseId ?? null, soughtBy: p.soughtBy ?? null,
        status: "sought", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "seek", "legal_opinion", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "opinion", p.id));
  });

  queue.subscribe(COMMANDS.opinionDraft, async (msg) => {
    const p = msg.payload as { opinionId: string; tenantId: string; counselName: string; opinionText: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const op = await repo.findOpinionByIdTx(tx, p.opinionId);
      if (!op) throw new Error(`opinion ${p.opinionId} not found`);
      if (op.tenantId !== p.tenantId) throw new Error("tenant mismatch");
      assertCanDraft(op.status ?? "sought");
      await repo.updateOpinion(tx, p.opinionId, {
        status: "drafted", counselName: p.counselName, opinionText: p.opinionText,
        draftedAt: new Date(), updatedBy: msg.actorId, version: (op.version ?? 1) + 1,
      });
      await audit(tx, msg, "draft", "legal_opinion", p.opinionId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "opinion", p.opinionId));
  });

  queue.subscribe(COMMANDS.opinionIssue, async (msg) => {
    const p = msg.payload as { opinionId: string; tenantId: string; opinionText?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const op = await repo.findOpinionByIdTx(tx, p.opinionId);
      if (!op) throw new Error(`opinion ${p.opinionId} not found`);
      if (op.tenantId !== p.tenantId) throw new Error("tenant mismatch");
      assertCanIssue(op.status ?? "sought");
      await repo.updateOpinion(tx, p.opinionId, {
        status: "issued",
        ...(p.opinionText ? { opinionText: p.opinionText } : {}),
        issuedAt: new Date(), updatedBy: msg.actorId, version: (op.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.opinionIssued, eventType: EVENTS.opinionIssued,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { opinionId: p.opinionId, opinionNo: op.opinionNo, caseId: op.caseId, subject: op.subject },
      });
      await audit(tx, msg, "issue", "legal_opinion", p.opinionId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "opinion", p.opinionId));
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType, resourceId, outcome: "success" },
  });
}
