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
  newValue?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType: "document_submission", resourceId, outcome: "success", ...(newValue ? { newValue } : {}) },
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
      status: string; authenticity: string; consent?: boolean;
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
      await audit(tx, msg, "digilocker_fetch", p.id, {
        digilockerConsent: { given: p.consent === true, recordedAt: new Date().toISOString() },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "document", p.id));
  });

  // GAP-CITIZEN-DOCUMENTS-02 — OAuth callback: consume the state (single-use),
  // persist the DPDP consent record ONLY on a successful code exchange, and record the pulled document. The
  // submission is only source_verified when the artefact passed local
  // verification (PKCS#7 structure + signer cert + trust-store chain); otherwise
  // it is received/pending with an honest provider status. Audit in the same txn.
  queue.subscribe(COMMANDS.documentDigilockerCallback, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; state: string; consentId: string;
      citizenId: string | null; applicationId: string | null; serviceId: string | null;
      docType: string; purpose: string; scope: string; consentExpiresAt: string;
      docUri: string | null; providerStatus: string; exchangeOk: boolean;
      verified: boolean; verifyReason: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Single-use is atomic: only the caller that flips consumed_at wins. A replayed
      // or unknown state records an audit row and mints nothing (no consent, no document).
      if ((await repo.consumeOauthStateTx(tx, p.state, msg.tenantId)) === 0) {
        await audit(tx, msg, "digilocker_callback_rejected", p.id, { reason: "state_already_consumed_or_unknown" });
        return;
      }
      // No consent and no document unless the code exchange actually succeeded.
      if (!p.exchangeOk) {
        await audit(tx, msg, "digilocker_callback_rejected", p.id, {
          reason: "code_exchange_failed", providerStatus: p.providerStatus,
        });
        return;
      }
      // Persist the consent record (who, citizen, purpose, docType, scope, grantedAt, expiresAt).
      await repo.insertConsentTx(tx, {
        id: p.consentId, tenantId: p.tenantId, actorId: msg.actorId,
        citizenId: p.citizenId, purpose: p.purpose, docType: p.docType, scope: p.scope,
        stateRef: p.state, expiresAt: new Date(p.consentExpiresAt),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertSubmission(tx, {
        id: p.id, tenantId: p.tenantId, applicationId: p.applicationId,
        citizenId: p.citizenId, serviceId: p.serviceId, docType: p.docType,
        source: "digilocker", digilockerRef: p.docUri,
        providerStatus: p.verified ? "verified" : (p.exchangeOk ? "unverified" : p.providerStatus),
        status: p.verified ? "verified" : "received",
        verificationStatus: p.verified ? "verified" : "pending",
        authenticity: p.verified ? "source_verified" : "unverified",
        ...(p.verified ? { verifiedBy: msg.actorId, verifiedAt: new Date() } : {}),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (p.verified) {
        await enqueue(tx, {
          topic: EVENTS.documentVerified, eventType: EVENTS.documentVerified,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, docType: p.docType, source: "digilocker", authenticity: "source_verified" },
        });
      }
      await audit(tx, msg, "digilocker_callback", p.id, {
        consentId: p.consentId,
        digilockerConsent: { purpose: p.purpose, docType: p.docType, scope: p.scope, grantedAt: new Date().toISOString(), expiresAt: p.consentExpiresAt },
        verification: { verified: p.verified, reason: p.verifyReason, providerStatus: p.providerStatus },
      });
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
