import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { verificationTransition } from "./domain.js";

const AUDIT = "audit.event.record";

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType: "document_submission", resourceId, outcome: "success" },
  });
}

export function registerDocumentsConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.documentUpload, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; applicationId: string | null; citizenId: string | null;
      serviceId: string | null; docType: string; storageRef: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertSubmission(tx, {
        id: p.id, tenantId: p.tenantId, applicationId: p.applicationId,
        citizenId: p.citizenId, serviceId: p.serviceId, docType: p.docType,
        source: "upload", storageRef: p.storageRef,
        status: "received", verificationStatus: "pending", authenticity: "self_attested",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "upload", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "document", p.id));
  });

  queue.subscribe(COMMANDS.documentDigilockerFetch, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; applicationId: string | null; citizenId: string | null;
      serviceId: string | null; docType: string; digilockerRef: string | null;
      providerStatus: string; configured: boolean; verificationStatus: string;
      status: string; authenticity: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertSubmission(tx, {
        id: p.id, tenantId: p.tenantId, applicationId: p.applicationId,
        citizenId: p.citizenId, serviceId: p.serviceId, docType: p.docType,
        source: "digilocker", digilockerRef: p.digilockerRef,
        providerStatus: p.providerStatus, status: p.status, verificationStatus: p.verificationStatus,
        authenticity: p.authenticity,
        ...(p.configured ? { verifiedBy: msg.actorId, verifiedAt: new Date() } : {}),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (p.configured) {
        await enqueue(tx, {
          topic: EVENTS.documentVerified, eventType: EVENTS.documentVerified,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, docType: p.docType, source: "digilocker", authenticity: p.authenticity },
        });
      }
      await audit(tx, msg, "digilocker_fetch", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "document", p.id));
  });

  queue.subscribe(COMMANDS.documentVerify, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; decision: string; reason?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const sub = await repo.findSubmissionByIdTx(tx, p.id, msg.tenantId);
      if (!sub || sub.status === "superseded") return;
      const t = verificationTransition(p.decision as "verify" | "reject" | "deficient");
      await repo.updateSubmission(tx, p.id, msg.tenantId, {
        status: t.status, verificationStatus: t.verificationStatus,
        ...(t.authenticity ? { authenticity: t.authenticity } : {}),
        deficiencyReason: p.decision === "deficient" ? (p.reason ?? null) : null,
        verifiedBy: msg.actorId, verifiedAt: new Date(), updatedBy: msg.actorId,
      });
      if (p.decision === "verify") {
        await enqueue(tx, {
          topic: EVENTS.documentVerified, eventType: EVENTS.documentVerified,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, docType: sub.docType, applicationId: sub.applicationId, source: sub.source },
        });
      }
      await audit(tx, msg, `verify_${p.decision}`, p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "document", p.id));
  });

  queue.subscribe(COMMANDS.documentResubmit, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; supersedesId: string; source: string;
      storageRef: string | null; digilockerRef: string | null; providerStatus: string | null;
      configured: boolean; verificationStatus: string; status: string; authenticity: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const prior = await repo.findSubmissionByIdTx(tx, p.supersedesId, msg.tenantId);
      if (!prior) return;
      await repo.insertSubmission(tx, {
        id: p.id, tenantId: p.tenantId, applicationId: prior.applicationId,
        citizenId: prior.citizenId, serviceId: prior.serviceId, docType: prior.docType,
        source: p.source, supersedesId: p.supersedesId,
        storageRef: p.storageRef, digilockerRef: p.digilockerRef, providerStatus: p.providerStatus,
        status: p.status, verificationStatus: p.verificationStatus, authenticity: p.authenticity,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateSubmission(tx, p.supersedesId, msg.tenantId, { status: "superseded", updatedBy: msg.actorId });
      await audit(tx, msg, "resubmit", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "document", p.supersedesId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "document", p.id));
  });
}
