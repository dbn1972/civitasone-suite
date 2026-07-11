import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { notices } from "./schema.js";
import * as repo from "./repo.js";
import { assertNoticeTransition, type NoticeStatus } from "./domain.js";

type IssueNoticePayload = {
  id: string;
  caseId: string;
  tenantId: string;
  noticeType: string;
  issuedTo?: string;
  issueDate: string; // YYYY-MM-DD
};

type RecordServicePayload = {
  id: string;
  noticeId: string;
  tenantId: string;
  serviceMode: string;
  recipient?: string;
  dispatchRef?: string;
  deliveryStatus?: string;
  servedAt?: string; // YYYY-MM-DD
  proof?: string;
};

type UpdateNoticeStatusPayload = {
  noticeId: string;
  tenantId: string;
  status: NoticeStatus;
  expectedVersion: number;
};

export function registerNoticeConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Issue a notice (§21).
  register<IssueNoticePayload>(COMMANDS.issueNotice, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertNotice(tx, {
        id: p.id,
        tenantId: p.tenantId,
        caseId: p.caseId,
        noticeType: p.noticeType,
        issuedTo: p.issuedTo ?? null,
        status: "issued",
        issueDate: p.issueDate,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.noticeIssued,
        eventType: EVENTS.noticeIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { caseId: p.caseId, noticeId: p.id, noticeType: p.noticeType, issueDate: p.issueDate },
      });
      await audit(tx, msg, "issue", "court_notice", p.id);
    });
  });

  // Record a service attempt (§21). Deterministic id makes the insert idempotent,
  // so no version guard is needed here.
  register<RecordServicePayload>(COMMANDS.recordService, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertService(tx, {
        id: p.id,
        tenantId: p.tenantId,
        noticeId: p.noticeId,
        serviceMode: p.serviceMode,
        recipient: p.recipient ?? null,
        dispatchRef: p.dispatchRef ?? null,
        deliveryStatus: p.deliveryStatus ?? "pending",
        servedAt: p.servedAt ?? null,
        proof: p.proof ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.noticeServiceRecorded,
        eventType: EVENTS.noticeServiceRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          noticeId: p.noticeId,
          serviceId: p.id,
          serviceMode: p.serviceMode,
          deliveryStatus: p.deliveryStatus ?? "pending",
        },
      });
      await audit(tx, msg, "record_service", "court_notice_service", p.id);
    });
  });

  // Update a notice's lifecycle status (§21) — version-guarded, state-machine-checked.
  register<UpdateNoticeStatusPayload>(COMMANDS.updateNoticeStatus, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const current = await repo.getNoticeForUpdate(tx, p.tenantId, p.noticeId);
      if (!current) throw new NonRetryableError(`NOTICE_NOT_FOUND: ${p.noticeId}`);
      if (current.status === p.status) return; // already at target; no-op

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: notice ${p.noticeId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }
      try {
        assertNoticeTransition(current.status, p.status);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      await versionedUpdate(tx, notices, {
        id: p.noticeId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          status: p.status,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "notice",
      });

      await enqueue(tx, {
        topic: EVENTS.noticeStatusChanged,
        eventType: EVENTS.noticeStatusChanged,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { noticeId: p.noticeId, from: current.status, to: p.status },
      });
      await audit(tx, msg, "update_status", "court_notice", p.noticeId);
    });
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
