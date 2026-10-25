import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";
import * as applicationRepo from "../application/repo.js";
import * as feeRepo from "../fee-payment/repo.js";
import { feePayments } from "../fee-payment/schema.js";
import { assertStatusTransition } from "../application/domain.js";
import { and, eq } from "drizzle-orm";
import { enqueuePackNotifications } from "../catalogue/notification-bindings.js";
import {
  buildCertNumber, hashPayload, signPayloadHash, generateVerifyToken, issuanceBlockReason,
} from "./domain.js";
import type { CertificateRow } from "./schema.js";

const log = pino({ name: "citizen.issuance.consumer" });
const AUDIT = "audit.event.record";

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
) {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType: "certificate", resourceId, outcome: "success" },
  });
}

function signedPayload(cert: {
  certNo: string; certType: string; subject: unknown; payload: unknown;
  validFrom: string | null; validTo: string | null;
}) {
  const hash = hashPayload(cert);
  return { hash, signature: signPayloadHash(hash) };
}

function isActive(cert: CertificateRow): boolean {
  return ["active", "amended", "renewed"].includes(cert.status);
}

export function registerIssuanceConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issuanceRequest, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; applicationId?: string; certType: string;
      subject: unknown; payload: unknown; validFrom?: string; validTo?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCertificate(tx, {
        id: p.id, tenantId: p.tenantId, applicationId: p.applicationId ?? null, certType: p.certType,
        status: "requested", subject: p.subject as never, payload: p.payload as never,
        validFrom: p.validFrom ?? null, validTo: p.validTo ?? null,
        requestedBy: msg.actorId, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertEvent(tx, {
        tenantId: p.tenantId, certificateId: p.id, eventType: "request",
        note: `Issuance requested for ${p.certType}`, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "issuance_request", p.id);
    });
    log.info({ id: p.id }, "issuance requested");
  });

  queue.subscribe(COMMANDS.issuanceApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let appliedApplicationId: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cert = await repo.findCertByIdTx(tx, p.id, msg.tenantId);
      if (!cert || cert.status !== "requested") return;
      if (cert.requestedBy === msg.actorId) return;
      // V4-G-11: a certificate tied to an application is issued only for an
      // approved (and, if fee-bearing, paid) application; otherwise leave it
      // `requested` and record why, so the checker can see the block.
      let linkedApp: Awaited<ReturnType<typeof applicationRepo.findApplicationByIdTx>> = null;
      if (cert.applicationId) {
        linkedApp = await applicationRepo.findApplicationByIdTx(tx, cert.applicationId, msg.tenantId);
        let feeBearing = false;
        let paymentSatisfied = false;
        if (linkedApp) {
          const schedule = await feeRepo.findActiveScheduleForService(tx, msg.tenantId, linkedApp.serviceId);
          feeBearing = !!schedule && schedule.baseAmount > 0;
          if (feeBearing) {
            const payments = await (tx as typeof db).select().from(feePayments)
              .where(and(eq(feePayments.tenantId, msg.tenantId), eq(feePayments.applicationId, linkedApp.id)));
            paymentSatisfied = payments.some((x) => x.status === "paid" || x.status === "offline_recorded" || x.amount === 0);
          }
        }
        const blocked = issuanceBlockReason({ applicationStatus: linkedApp?.status ?? null, feeBearing, paymentSatisfied });
        if (blocked) {
          await repo.insertEvent(tx, {
            tenantId: msg.tenantId, certificateId: p.id, eventType: "issue_blocked",
            note: `Issuance blocked: ${blocked}`, createdBy: msg.actorId, updatedBy: msg.actorId,
          });
          await audit(tx, msg, "issuance_blocked", p.id);
          return;
        }
      }
      const year = new Date().getUTCFullYear();
      const seq = await repo.nextSequence(tx, msg.tenantId, cert.certType, year);
      const certNo = buildCertNumber(cert.certType, year, seq);
      const verifyToken = generateVerifyToken();
      const { hash, signature } = signedPayload({
        certNo, certType: cert.certType, subject: cert.subject, payload: cert.payload,
        validFrom: cert.validFrom, validTo: cert.validTo,
      });
      await repo.updateCert(tx, p.id, msg.tenantId, {
        status: "active", certNo, seqYear: year, verifyToken,
        payloadHash: hash, signature, approvedBy: msg.actorId, issuedAt: new Date(), updatedBy: msg.actorId,
      });
      await repo.insertEvent(tx, {
        tenantId: msg.tenantId, certificateId: p.id, eventType: "issue",
        note: `Issued ${certNo}`, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.certificateIssued, eventType: EVENTS.certificateIssued,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          id: p.id, certNo, certType: cert.certType,
          applicationId: cert.applicationId, verifyToken,
        },
      });
      // FN-08: issued bindings with cert_no (when linked to a pack-backed application)
      if (cert.applicationId && linkedApp) {
        const app = linkedApp;
        appliedApplicationId = app.id;
        // V4-G-11: close the application (approved -> issued) in the same transaction.
        assertStatusTransition(app.status, "issued");
        await applicationRepo.updateApplication(tx, app.id, msg.tenantId, { status: "issued", updatedBy: msg.actorId });
        await applicationRepo.insertStatusHistory(tx, {
          tenantId: msg.tenantId, applicationId: app.id, fromStatus: app.status, toStatus: "issued",
          note: `Certificate ${certNo} issued`, createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueuePackNotifications(tx, {
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          serviceId: app.serviceId, lifecycleEvent: "issued",
          recipient: app.citizenId, recipientId: app.citizenId,
          variables: {
            applicationId: app.id,
            app_no: app.refNo ?? app.trackingNo ?? app.id,
            cert_no: certNo,
            cert_type: cert.certType,
            verify_token: verifyToken,
          },
          eventType: EVENTS.certificateIssued,
        });
      }
      await audit(tx, msg, "issuance_approve", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "certificate", p.id));
    if (appliedApplicationId) await cache.invalidate(cache.makeKey(msg.tenantId, "application", appliedApplicationId));
  });

  queue.subscribe(COMMANDS.issuanceAmend, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; payload: unknown; note?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cert = await repo.findCertByIdTx(tx, p.id, msg.tenantId);
      if (!cert || !isActive(cert) || !cert.certNo) return;
      const { hash, signature } = signedPayload({
        certNo: cert.certNo, certType: cert.certType, subject: cert.subject, payload: p.payload,
        validFrom: cert.validFrom, validTo: cert.validTo,
      });
      await repo.updateCert(tx, p.id, msg.tenantId, {
        status: "amended", payload: p.payload as never, payloadHash: hash, signature, updatedBy: msg.actorId,
      });
      await repo.insertEvent(tx, {
        tenantId: msg.tenantId, certificateId: p.id, eventType: "amend",
        note: p.note ?? "Amended", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "issuance_amend", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "certificate", p.id));
  });

  queue.subscribe(COMMANDS.issuanceRenew, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; validTo: string; validFrom?: string; note?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cert = await repo.findCertByIdTx(tx, p.id, msg.tenantId);
      if (!cert || !isActive(cert) || !cert.certNo) return;
      const validFrom = p.validFrom ?? cert.validFrom;
      const { hash, signature } = signedPayload({
        certNo: cert.certNo, certType: cert.certType, subject: cert.subject, payload: cert.payload,
        validFrom, validTo: p.validTo,
      });
      await repo.updateCert(tx, p.id, msg.tenantId, {
        status: "renewed", validFrom, validTo: p.validTo,
        payloadHash: hash, signature, updatedBy: msg.actorId,
      });
      await repo.insertEvent(tx, {
        tenantId: msg.tenantId, certificateId: p.id, eventType: "renew",
        note: p.note ?? `Renewed to ${p.validTo}`, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "issuance_renew", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "certificate", p.id));
  });

  queue.subscribe(COMMANDS.issuanceRevoke, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; action: "cancel" | "revoke"; reason?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cert = await repo.findCertByIdTx(tx, p.id, msg.tenantId);
      if (!cert || ["cancelled", "revoked"].includes(cert.status)) return;
      const status = p.action === "cancel" ? "cancelled" : "revoked";
      await repo.updateCert(tx, p.id, msg.tenantId, { status, updatedBy: msg.actorId });
      await repo.insertEvent(tx, {
        tenantId: msg.tenantId, certificateId: p.id, eventType: p.action,
        note: p.reason ?? status, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.certificateRevoked, eventType: EVENTS.certificateRevoked,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, certNo: cert.certNo, status },
      });
      await audit(tx, msg, `issuance_${p.action}`, p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "certificate", p.id));
  });
}
