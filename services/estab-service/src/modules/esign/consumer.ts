import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import * as filesRepo from "../files/repo.js";
import { findDfaById } from "../dfa/repo.js";
import { getProvider } from "./providers.js";
import { assertSigningAllowed, computeDocHash, DomainError, type SignMethod, type SignSubject } from "./domain.js";
import { COMMANDS } from "./commands.js";

const AUDIT_TOPIC = "audit.event.record";

function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string, metadata: Record<string, unknown> = {}) {
  return enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType: "signature", resourceId, outcome: "success", metadata },
  });
}

export function registerEsignConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.esignConfigSet, async (msg) => {
    const p = msg.payload as { tenantId: string; mode: "disabled" | "optional" | "mandatory"; allowedMethods: SignMethod[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.upsertSignConfig(tx, p.tenantId, p.mode, p.allowedMethods, msg.actorId);
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "estab", action: "esign_config_set", resourceType: "sign_config", resourceId: p.tenantId, outcome: "success", metadata: { mode: p.mode, allowedMethods: p.allowedMethods } },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "esign_config", "_"));
  });

  queue.subscribe(COMMANDS.esignSign, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; subjectType: SignSubject; subjectId: string;
      method: SignMethod; signerId: string;
      pkcs7?: string; certSubject?: string; certIssuer?: string; certSerial?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Tenant policy gate: signing must be enabled and the method permitted.
      const config = await repo.getSignConfigTx(tx, p.tenantId);
      assertSigningAllowed(config, p.method);

      // Resolve the artefact being signed and its content hash.
      let body: string | null = null;
      let fileId: string | null = null;
      if (p.subjectType === "noting") {
        const note = await filesRepo.findNotingById(p.subjectId, p.tenantId);
        if (!note) throw new DomainError("SUBJECT_NOT_FOUND", `noting ${p.subjectId} not found`);
        body = note.body; fileId = note.fileId;
      } else {
        const dfa = await findDfaById(p.subjectId, p.tenantId);
        if (!dfa) throw new DomainError("SUBJECT_NOT_FOUND", `dfa ${p.subjectId} not found`);
        body = dfa.body; fileId = dfa.fileId ?? null;
      }
      const docHash = computeDocHash(p.subjectType, p.subjectId, body);

      const provider = getProvider(p.method);
      let pkcs7: string, certSerial: string, certSubject: string, certIssuer: string, signedAt: Date, txnRef: string, valid: boolean;

      if (p.pkcs7) {
        // DSC desktop-signer path: client produced the CMS; we VERIFY it.
        const v = await provider.verify({
          docHash, pkcs7: p.pkcs7,
          ...(p.certSubject ? { certSubject: p.certSubject } : {}),
          ...(p.certIssuer ? { certIssuer: p.certIssuer } : {}),
          ...(p.certSerial ? { certSerial: p.certSerial } : {}),
        });
        if (!v.valid || v.revoked) {
          throw new DomainError("SIGNATURE_INVALID", `client signature failed verification (valid=${v.valid}, revoked=${v.revoked})`);
        }
        pkcs7 = p.pkcs7; certSerial = p.certSerial ?? "—"; certSubject = p.certSubject ?? v.subject;
        certIssuer = p.certIssuer ?? v.issuer; signedAt = new Date(); txnRef = `DSC-CLIENT-${p.id.slice(0, 12)}`; valid = true;
      } else {
        // Aadhaar eSign (server gateway) path — provider signs and returns CMS.
        const r = await provider.sign({ docHash, signer: { signerId: p.signerId } });
        pkcs7 = r.pkcs7; certSerial = r.certSerial; certSubject = r.certSubject;
        certIssuer = r.certIssuer; signedAt = r.signedAt; txnRef = r.txnRef;
        const v = await provider.verify({ docHash, pkcs7 });
        valid = v.valid && !v.revoked;
      }

      await repo.insertSignature(tx, {
        id: p.id, tenantId: p.tenantId, subjectType: p.subjectType, subjectId: p.subjectId,
        fileId, docHash, method: p.method, provider: provider.name, pkcs7,
        certSerial, certSubject, certIssuer, signerId: p.signerId,
        signedAt, revocationCheckedAt: new Date(), valid, txnRef,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "esign_signed", p.id, { subjectType: p.subjectType, subjectId: p.subjectId, method: p.method, provider: provider.name, valid });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "file", p.subjectId));
  });
}
