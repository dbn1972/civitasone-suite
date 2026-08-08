import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as intakeRepo from "./intake-repo.js";
import * as portalRepo from "../portal/repo.js";
import * as analyticsRepo from "../analytics/repo.js";
import { enqueuePackNotifications } from "../catalogue/notification-bindings.js";
import { assertStatusTransition, assertRequiredDocuments, buildPresignedUploadUrl, computeDeadline, toDateString, isSlaBreached } from "./domain.js";

export function registerApplicationConsumers(rawQueue: Queue): void {
  // #146 NOBYPASSRLS: every handler must run inside the message's tenant
  // context so wrapWithTenantGuc sets app.tenant_id (RLS) in db.transaction().
  const queue = tenantScoped(rawQueue);
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
      // FN-08: pack bindings for lifecycle event "submitted"
      await enqueuePackNotifications(tx, {
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        serviceId: p.serviceId, lifecycleEvent: "submitted",
        recipient: p.citizenId, recipientId: p.citizenId,
        variables: { applicationId: p.id, app_no: p.refNo },
        eventType: "citizen.application.submitted",
      });
      await audit(tx, msg, "submit", "citizen_application", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.id));
  });

  queue.subscribe(COMMANDS.applicationStatusUpdate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; status: string; note?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const app = await repo.findApplicationByIdTx(tx, p.id, msg.tenantId);
      if (!app) return;
      assertStatusTransition(app.status, p.status as any);
      await repo.updateApplication(tx, p.id, msg.tenantId, { status: p.status, updatedBy: msg.actorId });
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
      }
      // FN-08: pack bindings for approved / rejected / issued; fall back to system
      // template for approved when the published pack has no bindings for that event.
      const packEvent =
        p.status === "approved" || p.status === "rejected" || p.status === "issued"
          ? (p.status as "approved" | "rejected" | "issued")
          : null;
      if (packEvent) {
        const sent = await enqueuePackNotifications(tx, {
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          serviceId: app.serviceId, lifecycleEvent: packEvent,
          recipient: app.citizenId ?? p.id,
          recipientId: app.citizenId ?? undefined,
          variables: {
            applicationId: p.id,
            app_no: app.refNo ?? app.trackingNo ?? p.id,
          },
          eventType:
            packEvent === "approved"
              ? EVENTS.applicationApproved
              : `citizen.application.${packEvent}`,
        });
        if (packEvent === "approved" && sent === 0) {
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
      }
      await audit(tx, msg, "status_update", "citizen_application", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.id));
  });

  queue.subscribe(COMMANDS.applicationDocUpload, async (msg) => {
    const p = msg.payload as { id: string; applicationId: string; tenantId: string; docType: string; ownerCitizenId?: string | null };
    const docUrl = buildPresignedUploadUrl(p.tenantId, p.applicationId, p.docType);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // P0-1: re-assert that the target application belongs to the verified owner.
      const app = await repo.findApplicationByIdTx(tx, p.applicationId, msg.tenantId);
      if (!app) return;
      if (p.ownerCitizenId != null && app.citizenId !== p.ownerCitizenId) return;
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
      const app = await repo.findApplicationByIdTx(tx, p.applicationId, msg.tenantId);
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

  queue.subscribe(COMMANDS.draftSave, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; citizenId: string; serviceId: string;
      serviceKey?: string | null; channel: string; assistedBy: string | null;
      formData: Record<string, unknown>; documentTypes: string[];
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await intakeRepo.insertDraft(tx, {
        id: p.id, tenantId: p.tenantId, citizenId: p.citizenId, serviceId: p.serviceId,
        serviceKey: p.serviceKey ?? null, channel: p.channel, assistedBy: p.assistedBy,
        formData: p.formData, documentTypes: p.documentTypes, status: "draft",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "draft_save", "application_intake", p.id);
    });
  });

  queue.subscribe(COMMANDS.draftUpdate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      formData?: Record<string, unknown>; documentTypes?: string[];
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const draft = await intakeRepo.findDraftByIdTx(tx, p.id, msg.tenantId);
      if (!draft || draft.status !== "draft") return;
      await intakeRepo.updateDraft(tx, p.id, msg.tenantId, {
        ...(p.formData ? { formData: p.formData } : {}),
        ...(p.documentTypes ? { documentTypes: p.documentTypes } : {}),
        updatedBy: msg.actorId,
      });
      await audit(tx, msg, "draft_update", "application_intake", p.id);
    });
  });

  queue.subscribe(COMMANDS.draftSubmit, async (msg) => {
    const p = msg.payload as {
      id: string; draftId: string; tenantId: string; trackingNo: string; channel: string;
      documentTypes?: string[];
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const draft = await intakeRepo.findDraftByIdTx(tx, p.draftId, msg.tenantId);
      if (!draft || draft.status !== "draft") return;
      const now = new Date();
      await repo.insertApplication(tx, {
        id: p.id, tenantId: p.tenantId, citizenId: draft.citizenId, serviceId: draft.serviceId,
        refNo: p.trackingNo, status: "submitted", trackingNo: p.trackingNo, channel: draft.channel,
        assistedBy: draft.assistedBy, acknowledgedAt: now, submittedAt: now,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertStatusHistory(tx, {
        tenantId: p.tenantId, applicationId: p.id, fromStatus: null, toStatus: "submitted",
        note: `Acknowledged via ${draft.channel} (tracking ${p.trackingNo})`,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await intakeRepo.updateDraft(tx, p.draftId, msg.tenantId, {
        status: "submitted", applicationId: p.id, updatedBy: msg.actorId,
      });
      // FN-08: pack bindings for lifecycle event "submitted" (intake path)
      await enqueuePackNotifications(tx, {
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        serviceId: draft.serviceId, lifecycleEvent: "submitted",
        recipient: draft.citizenId, recipientId: draft.citizenId,
        variables: { applicationId: p.id, app_no: p.trackingNo },
        eventType: "citizen.application.submitted",
      });
      await audit(tx, msg, "draft_submit", "application_intake", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "application", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType, resourceId, outcome: "success" },
  });
}
