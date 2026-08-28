import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { invalidateItemAndLists } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertCanDraft, assertCanIssue } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

// Every handler below invalidates both the single-item "opinion" key and the
// plural "opinions" list-cache key that queries.ts's listOpinions() reads
// through — the list key used to be left stale after every write (the same
// bug found and fixed for counsel-briefs in
// fix/legal-wire-real-counsel-brief-endpoint, confirmed live there via
// POST-then-immediate-GET). No case-scoped invalidation primitive exists for
// this key shape, so this busts every cached list in the tenant rather than
// leaving any of them wrong.
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
    await invalidateItemAndLists(msg.tenantId, { resource: "opinion", id: p.id }, ["opinions"]);
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
    await invalidateItemAndLists(msg.tenantId, { resource: "opinion", id: p.opinionId }, ["opinions"]);
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
    await invalidateItemAndLists(msg.tenantId, { resource: "opinion", id: p.opinionId }, ["opinions"]);
  });

  queue.subscribe(COMMANDS.opinionSubmitApproval, async (msg) => {
    const p = msg.payload as { opinionId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const op = await repo.findOpinionByIdTx(tx, p.opinionId);
      if (!op || op.tenantId !== p.tenantId) return;
      await repo.updateOpinion(tx, p.opinionId, {
        status: "pending_approval", updatedBy: msg.actorId, version: (op.version ?? 1) + 1,
      });
      await audit(tx, msg, "submit_for_eoffice_approval", "legal_opinion", p.opinionId);
    });
    await invalidateItemAndLists(msg.tenantId, { resource: "opinion", id: p.opinionId }, ["opinions"]);
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType, resourceId, outcome: "success" },
  });
}
