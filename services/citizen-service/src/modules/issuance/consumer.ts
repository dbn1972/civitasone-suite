import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";
import {
  buildCertNumber, hashPayload, signPayloadHash, generateVerifyToken,
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
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cert = await repo.findCertByIdTx(tx, p.id, msg.tenantId);
      if (!cert || cert.status !== "requested") return;
      if (cert.requestedBy === msg.actorId) return;
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
      await audit(tx, msg, "issuance_approve", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "certificate", p.id));
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
