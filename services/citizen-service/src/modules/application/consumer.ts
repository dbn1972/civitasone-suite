import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as portalRepo from "../portal/repo.js";
import * as analyticsRepo from "../analytics/repo.js";
import { assertStatusTransition, assertRequiredDocuments, buildPresignedUploadUrl, computeDeadline, toDateString, isSlaBreached } from "./domain.js";

export function registerApplicationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.applicationSubmit, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; citizenId: string; serviceId: string;
      refNo: string; serviceType: string; documentTypes?: string[];
    };
    const service = await portalRepo.findServiceById(p.serviceId, p.tenantId);
    const requiredDocs = service?.requiredDocs ?? [];
    const provided = p.documentTypes ?? [];
    let initialStatus: "submitted" | "pending_docs" = "submitted";
    try {
      assertRequiredDocuments(requiredDocs, provided);
    } catch {
      initialStatus = "pending_docs";
    }
    const sla = await analyticsRepo.findSlaConfig(p.tenantId, p.serviceType);
    const maxDays = sla?.maxDays ?? 30;
    const deadline = toDateString(computeDeadline(new Date(), maxDays));

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertApplication(tx, {
        id: p.id, tenantId: p.tenantId, citizenId: p.citizenId, serviceId: p.serviceId,
        refNo: p.refNo, status: initialStatus, deadline,
        submittedAt: new Date(), createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertStatusHistory(tx, {
        tenantId: p.tenantId, applicationId: p.id,
        fromStatus: null, toStatus: initialStatus,
        note: initialStatus === "pending_docs" ? "Missing required documents" : "Application submitted",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "submit", "citizen_application", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.id));
  });

  queue.subscribe(COMMANDS.applicationStatusUpdate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; status: string; note?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findApplicationByIdTx(tx, p.id);
      if (!app) return;
      assertStatusTransition(app.status, p.status as any);
      await repo.updateApplication(tx, p.id, { status: p.status, updatedBy: msg.actorId });
      await repo.insertStatusHistory(tx, {
        tenantId: p.tenantId, applicationId: p.id,
        fromStatus: app.status, toStatus: p.status, note: p.note ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (p.status === "approved") {
        await enqueue(tx, {
          topic: EVENTS.applicationApproved, eventType: EVENTS.applicationApproved,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { applicationId: p.id, citizenId: app.citizenId },
        });
        await enqueue(tx, {
          topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: buildNotificationPayload({
            eventType: EVENTS.applicationApproved,
            recipient: app.citizenId ?? p.id,
            recipientId: app.citizenId ?? undefined,
            variables: { applicationId: p.id },
          }),
        });
      }
      await audit(tx, msg, "status_update", "citizen_application", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.id));
  });

  queue.subscribe(COMMANDS.applicationDocUpload, async (msg) => {
    const p = msg.payload as { id: string; applicationId: string; tenantId: string; docType: string };
    const docUrl = buildPresignedUploadUrl(p.tenantId, p.applicationId, p.docType);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertDocument(tx, {
        id: p.id, tenantId: p.tenantId, applicationId: p.applicationId,
        docType: p.docType, docUrl,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "doc_upload", "citizen_application", p.applicationId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.applicationId));
  });

  queue.subscribe(COMMANDS.applicationSlaCheck, async (msg) => {
    const p = msg.payload as { tenantId: string; applicationId: string; serviceType: string; maxDays: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findApplicationByIdTx(tx, p.applicationId);
      if (!app) return;
      if (!isSlaBreached(app.createdAt, p.maxDays, app.status)) return;
      await enqueue(tx, {
        topic: EVENTS.applicationSlaBreached, eventType: EVENTS.applicationSlaBreached,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { applicationId: p.applicationId, citizenId: app.citizenId, serviceType: p.serviceType },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.applicationSlaBreached,
          recipient: app.citizenId ?? p.applicationId,
          recipientId: app.citizenId ?? undefined,
          variables: { applicationId: p.applicationId, serviceType: p.serviceType },
        }),
      });
      await audit(tx, msg, "sla_breached", "citizen_application", p.applicationId);
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType, resourceId, outcome: "success" },
  });
}
