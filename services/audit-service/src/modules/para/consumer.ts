import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUME_TOPICS, EVENTS } from "../../topics.js";
import * as obsRepo from "../observation/repo.js";
import { assertCanDraftPara } from "../observation/domain.js";
import * as repo from "./repo.js";
import { assertCanTransition, assertBodyMutable } from "./domain.js";
import type { ParaStatus } from "./schema.js";

const AUDIT_TOPIC = CONSUME_TOPICS.auditEventRecord;

/** Raised when an optimistic-locked update affects 0 rows (stale version / cross-tenant). */
class StaleWriteError extends Error {
  readonly status = 409;
  readonly code = "VERSION_CONFLICT";
  constructor(resource: string, id: string) {
    super(`[VERSION_CONFLICT] ${resource} ${id} was modified concurrently`);
  }
}

export function registerParaConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.paraDraft, async (msg) => {
    const p = msg.payload as {
      id: string; observationId: string; tenantId: string; paraNo: string;
      deptRef: string; body: string; sourceRef?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const obs = await obsRepo.findObservationByIdTx(tx, p.observationId, p.tenantId);
      if (!obs) throw new Error(`observation ${p.observationId} not found`);
      assertCanDraftPara(obs.status ?? "open");
      await repo.insertPara(tx, {
        id: p.id, tenantId: p.tenantId, paraNo: p.paraNo, observationId: p.observationId,
        deptRef: p.deptRef, body: p.body, category: obs.category ?? "compliance",
        amountInvolvedMinor: obs.amountInvolvedMinor ?? 0n, sourceRef: p.sourceRef ?? null,
        status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertStatusHistory(tx, {
        id: randomUUID(), tenantId: p.tenantId, paraId: p.id,
        fromStatus: "draft", toStatus: "draft", reason: "created from observation",
        createdBy: msg.actorId,
      });
      const obsRows = await obsRepo.updateObservationVersioned(tx, p.observationId, p.tenantId, obs.version ?? 1, {
        status: "para_drafted", updatedBy: msg.actorId, version: (obs.version ?? 1) + 1,
      });
      if (obsRows !== 1) throw new StaleWriteError("observation", p.observationId);
      await audit(tx, msg, "draft", "para", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "para", p.id));
  });

  queue.subscribe(COMMANDS.paraIssue, async (msg) => {
    const p = msg.payload as { paraId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const para = await repo.findParaByIdTx(tx, p.paraId, p.tenantId);
      if (!para) throw new Error(`para ${p.paraId} not found`);
      assertCanTransition(para.status as ParaStatus, "issued");
      const issuedRows = await repo.updateParaVersioned(tx, p.paraId, p.tenantId, para.version ?? 1, {
        status: "issued", issuedAt: new Date(), updatedBy: msg.actorId, version: (para.version ?? 1) + 1,
      });
      if (issuedRows !== 1) throw new StaleWriteError("para", p.paraId);
      await repo.insertStatusHistory(tx, {
        id: randomUUID(), tenantId: p.tenantId, paraId: p.paraId,
        fromStatus: para.status ?? "draft", toStatus: "issued", reason: "issued to department",
        createdBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.paraIssued, eventType: EVENTS.paraIssued,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { paraId: p.paraId, deptRef: para.deptRef, paraNo: para.paraNo },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.paraIssued,
          recipient: para.deptRef ?? "audit-dept",
          variables: { paraId: p.paraId, paraNo: para.paraNo ?? "" },
        }),
      });
      await audit(tx, msg, "issue", "para", p.paraId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "para", p.paraId));
  });

  queue.subscribe(COMMANDS.paraDeptResponse, async (msg) => {
    const p = msg.payload as {
      paraId: string; tenantId: string; responseBody: string; respondedByRef: string;
      body?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const para = await repo.findParaByIdTx(tx, p.paraId, p.tenantId);
      if (!para) throw new Error(`para ${p.paraId} not found`);
      if (p.body !== undefined) {
        assertBodyMutable(para.status as ParaStatus);
      }
      assertCanTransition(para.status as ParaStatus, "replied");
      await repo.insertDeptResponse(tx, {
        id: randomUUID(), tenantId: p.tenantId, paraId: p.paraId,
        responseBody: p.responseBody, respondedByRef: p.respondedByRef,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const repliedRows = await repo.updateParaVersioned(tx, p.paraId, p.tenantId, para.version ?? 1, {
        status: "replied", updatedBy: msg.actorId, version: (para.version ?? 1) + 1,
      });
      if (repliedRows !== 1) throw new StaleWriteError("para", p.paraId);
      await repo.insertStatusHistory(tx, {
        id: randomUUID(), tenantId: p.tenantId, paraId: p.paraId,
        fromStatus: para.status ?? "issued", toStatus: "replied", reason: "department response received",
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "dept_response", "para", p.paraId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "para", p.paraId));
  });

  queue.subscribe(COMMANDS.paraSettle, async (msg) => {
    const p = msg.payload as { paraId: string; tenantId: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const para = await repo.findParaByIdTx(tx, p.paraId, p.tenantId);
      if (!para) throw new Error(`para ${p.paraId} not found`);
      assertCanTransition(para.status as ParaStatus, "settled");
      const settledRows = await repo.updateParaVersioned(tx, p.paraId, p.tenantId, para.version ?? 1, {
        status: "settled", updatedBy: msg.actorId, version: (para.version ?? 1) + 1,
      });
      if (settledRows !== 1) throw new StaleWriteError("para", p.paraId);
      await repo.insertStatusHistory(tx, {
        id: randomUUID(), tenantId: p.tenantId, paraId: p.paraId,
        fromStatus: para.status ?? "replied", toStatus: "settled", reason: p.reason ?? "settled",
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "settle", "para", p.paraId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "para", p.paraId));
  });

  queue.subscribe(COMMANDS.paraPendingRecovery, async (msg) => {
    const p = msg.payload as { paraId: string; tenantId: string; reason?: string; dueDate?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const para = await repo.findParaByIdTx(tx, p.paraId, p.tenantId);
      if (!para) throw new Error(`para ${p.paraId} not found`);
      assertCanTransition(para.status as ParaStatus, "pending_recovery");
      const pendingRows = await repo.updateParaVersioned(tx, p.paraId, p.tenantId, para.version ?? 1, {
        status: "pending_recovery", updatedBy: msg.actorId, version: (para.version ?? 1) + 1,
      });
      if (pendingRows !== 1) throw new StaleWriteError("para", p.paraId);
      await repo.insertStatusHistory(tx, {
        id: randomUUID(), tenantId: p.tenantId, paraId: p.paraId,
        fromStatus: para.status ?? "replied", toStatus: "pending_recovery", reason: p.reason ?? "pending recovery",
        createdBy: msg.actorId,
      });
      const registerId = randomUUID();
      await enqueue(tx, {
        topic: COMMANDS.pendingRegisterCreate, eventType: COMMANDS.pendingRegisterCreate,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: registerId, tenantId: p.tenantId, paraId: p.paraId, deptRef: para.deptRef,
          amountInvolvedMinor: (para.amountInvolvedMinor ?? 0n).toString(), dueDate: p.dueDate,
        },
      });
      await enqueue(tx, {
        topic: EVENTS.paraPendingRecovery, eventType: EVENTS.paraPendingRecovery,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { paraId: p.paraId, deptRef: para.deptRef, amountInvolvedMinor: (para.amountInvolvedMinor ?? 0n).toString() },
      });
      await audit(tx, msg, "pending_recovery", "para", p.paraId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "para", p.paraId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "pending_register", "all"));
  });

  queue.subscribe(COMMANDS.paraClose, async (msg) => {
    const p = msg.payload as { paraId: string; tenantId: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const para = await repo.findParaByIdTx(tx, p.paraId, p.tenantId);
      if (!para) throw new Error(`para ${p.paraId} not found`);
      assertCanTransition(para.status as ParaStatus, "closed");
      const closedRows = await repo.updateParaVersioned(tx, p.paraId, p.tenantId, para.version ?? 1, {
        status: "closed", updatedBy: msg.actorId, version: (para.version ?? 1) + 1,
      });
      if (closedRows !== 1) throw new StaleWriteError("para", p.paraId);
      await repo.insertStatusHistory(tx, {
        id: randomUUID(), tenantId: p.tenantId, paraId: p.paraId,
        fromStatus: para.status ?? "settled", toStatus: "closed",
        reason: p.reason ?? "closed",
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "close", "para", p.paraId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "para", p.paraId));
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "audit", action, resourceType, resourceId, outcome: "success" },
  });
}
