import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "medical-consumer" });
const AUDIT = "audit.event.record";

export function registerMedicalConsumers(queue: Queue): void {
  // GAP2-HRMS-MEDICAL-01 / -02: the medical create and approve/reject writes
  // run as the module's disclosed synchronous raw-SQL exception in
  // medical/routes.ts (not CQRS), so these two consumers do NOT perform the
  // business write — they ONLY record the precise audit.event.record the
  // coarse onResponse hook cannot (which claim, approve vs reject, amount).
  // The routes publish these two commands fire-and-forget AFTER their own
  // write committed (see routes.ts's auditMedicalClaimCreate /
  // auditMedicalClaimDecision), identical in shape to medicalClaimsListRead
  // below: msg.payload is already the exact audit shape to persist, so it
  // passes straight through as the audit event's payload. This keeps every
  // queue.subscribe in this module matched by a queue.publish and makes the
  // write path's audit story honest.
  queue.subscribe(COMMANDS.medicalClaimCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: msg.payload as Record<string, unknown>,
      });
    });
    log.info({ messageId: msg.messageId }, "medical claim create audit recorded");
  });

  queue.subscribe(COMMANDS.medicalClaimApprove, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: msg.payload as Record<string, unknown>,
      });
    });
    log.info({ messageId: msg.messageId }, "medical claim decision audit recorded");
  });

  // GAP-HR-MEDICAL-01 (DPDP): the actual audit-outbox insert for a
  // privileged bulk list read — published (fire-and-forget) by routes.ts's
  // auditMedicalClaimsListRead, since a route may not write to Postgres
  // directly. msg.payload is already the exact shape the read route wants
  // recorded, so it passes straight through as the audit event's payload.
  queue.subscribe(COMMANDS.medicalClaimsListRead, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: msg.payload as Record<string, unknown>,
      });
    });
    log.info({ messageId: msg.messageId }, "medical claims list-read audit recorded");
  });

  log.info("medical consumers registered");
}
