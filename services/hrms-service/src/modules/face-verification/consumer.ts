import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.face-verification.consumer" });
const AUDIT = "audit.event.record";

export function registerFaceVerificationConsumers(queue: Queue): void {
  queue.subscribe("hrms.face_verification.upload_photo", async (msg) => {
    const p = msg.payload as {
      employeeId: string; tenantId: string;
      photoKey: string; photoBucket: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.face_verification.photo_uploaded",
        eventType: "hrms.face_verification.photo_uploaded",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { employeeId: p.employeeId, photoKey: p.photoKey },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "face_photo_upload", resourceType: "profile_photo", resourceId: p.employeeId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:face_verification:*`);
    log.info({ id: msg.messageId, employeeId: p.employeeId }, "Processed face_verification.upload_photo");
  });

  queue.subscribe("hrms.face_verification.verify", async (msg) => {
    const p = msg.payload as {
      employeeId: string; tenantId: string;
      selfieKey: string; geoAttendanceId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.face_verification.verified",
        eventType: "hrms.face_verification.verified",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { employeeId: p.employeeId, geoAttendanceId: p.geoAttendanceId },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "face_verify", resourceType: "face_verification", resourceId: p.employeeId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:face_verification:*`);
    log.info({ id: msg.messageId, employeeId: p.employeeId }, "Processed face_verification.verify");
  });

  queue.subscribe("hrms.face_verification.config_update", async (msg) => {
    const p = msg.payload as { tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.face_verification.config_updated",
        eventType: "hrms.face_verification.config_updated",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { tenantId: p.tenantId },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "face_config_update", resourceType: "face_config", resourceId: msg.messageId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:face_verification:*`);
    log.info({ id: msg.messageId }, "Processed face_verification.config_update");
  });
}
