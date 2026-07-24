import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { CertificateRow } from "./schema.js";
import {
  normalizeCertType, buildCertNumber, hashPayload, signPayloadHash, generateVerifyToken,
} from "./domain.js";
import type { RequestIssuanceBody, AmendBody, RenewBody, RevokeBody } from "./validators.js";

async function audit(tx: Parameters<typeof enqueue>[0], ctx: RequestContext, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "citizen", action, resourceType: "certificate", resourceId, outcome: "success" },
  });
}

function signedPayload(cert: { certNo: string; certType: string; subject: unknown; payload: unknown; validFrom: string | null; validTo: string | null }): {
  hash: string; signature: string;
} {
  const hash = hashPayload(cert);
  return { hash, signature: signPayloadHash(hash) };
}

/** Maker step — request a certificate/licence/permit issuance (status `requested`). */
export async function requestIssuance(ctx: RequestContext, body: RequestIssuanceBody): Promise<{ id: string; status: string; certType: string }> {
  const id = randomUUID();
  const certType = normalizeCertType(body.certType);
  await db.transaction(async (tx) => {
    await repo.insertCertificate(tx, {
      id, tenantId: ctx.tenantId, applicationId: body.applicationId ?? null, certType,
      status: "requested", subject: body.subject, payload: body.payload,
      validFrom: body.validFrom ?? null, validTo: body.validTo ?? null,
      requestedBy: ctx.actorId, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await repo.insertEvent(tx, {
      tenantId: ctx.tenantId, certificateId: id, eventType: "request",
      note: `Issuance requested for ${certType}`, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "issuance_request", id);
  });
  return { id, status: "requested", certType };
}

/**
 * Checker step — approve issuance (maker-checker: approver MUST differ from the
 * requester). On approval: allocate the gapless cert number, produce the signed
 * output (payload hash + HMAC seal), mint the public verify token, activate.
 */
export async function approveIssuance(ctx: RequestContext, id: string): Promise<{
  id: string; status: string; certNo: string; verifyToken: string; payloadHash: string; signature: string;
}> {
  return db.transaction(async (tx) => {
    const cert = await repo.findCertByIdTx(tx, id, ctx.tenantId);
    if (!cert) throw new HttpError(404, "NOT_FOUND", "certificate not found");
    if (cert.status !== "requested") throw new HttpError(409, "INVALID_STATE", "only a requested certificate can be approved");
    // Maker-checker: the approver must not be the requester.
    if (cert.requestedBy === ctx.actorId) {
      throw new HttpError(403, "MAKER_CHECKER", "issuance approver must differ from the requester");
    }
    const year = new Date().getUTCFullYear();
    const seq = await repo.nextSequence(tx, ctx.tenantId, cert.certType, year);
    const certNo = buildCertNumber(cert.certType, year, seq);
    const verifyToken = generateVerifyToken();
    const { hash, signature } = signedPayload({
      certNo, certType: cert.certType, subject: cert.subject, payload: cert.payload,
      validFrom: cert.validFrom, validTo: cert.validTo,
    });
    await repo.updateCert(tx, id, ctx.tenantId, {
      status: "active", certNo, seqYear: year, verifyToken,
      payloadHash: hash, signature, approvedBy: ctx.actorId, issuedAt: new Date(), updatedBy: ctx.actorId,
    });
    await repo.insertEvent(tx, {
      tenantId: ctx.tenantId, certificateId: id, eventType: "issue",
      note: `Issued ${certNo}`, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.certificateIssued, eventType: EVENTS.certificateIssued,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { id, certNo, certType: cert.certType, applicationId: cert.applicationId, verifyToken },
    });
    await audit(tx, ctx, "issuance_approve", id);
    return { id, status: "active", certNo, verifyToken, payloadHash: hash, signature };
  });
}

function assertActive(cert: CertificateRow): void {
  if (!["active", "amended", "renewed"].includes(cert.status)) {
    throw new HttpError(409, "NOT_ACTIVE", `certificate is ${cert.status}`);
  }
}

/** Re-sign an amended payload in place (keeps the same cert number, re-seals). */
export async function amendCertificate(ctx: RequestContext, id: string, body: AmendBody): Promise<{ id: string; status: string; payloadHash: string }> {
  return db.transaction(async (tx) => {
    const cert = await repo.findCertByIdTx(tx, id, ctx.tenantId);
    if (!cert) throw new HttpError(404, "NOT_FOUND", "certificate not found");
    assertActive(cert);
    const { hash, signature } = signedPayload({
      certNo: cert.certNo!, certType: cert.certType, subject: cert.subject, payload: body.payload,
      validFrom: cert.validFrom, validTo: cert.validTo,
    });
    await repo.updateCert(tx, id, ctx.tenantId, {
      status: "amended", payload: body.payload, payloadHash: hash, signature, updatedBy: ctx.actorId,
    });
    await repo.insertEvent(tx, {
      tenantId: ctx.tenantId, certificateId: id, eventType: "amend",
      note: body.note ?? "Amended", createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "issuance_amend", id);
    return { id, status: "amended", payloadHash: hash };
  });
}

/** Extend validity → status `renewed`, re-sealed with the new window. */
export async function renewCertificate(ctx: RequestContext, id: string, body: RenewBody): Promise<{ id: string; status: string; validTo: string }> {
  return db.transaction(async (tx) => {
    const cert = await repo.findCertByIdTx(tx, id, ctx.tenantId);
    if (!cert) throw new HttpError(404, "NOT_FOUND", "certificate not found");
    assertActive(cert);
    const validFrom = body.validFrom ?? cert.validFrom;
    const { hash, signature } = signedPayload({
      certNo: cert.certNo!, certType: cert.certType, subject: cert.subject, payload: cert.payload,
      validFrom, validTo: body.validTo,
    });
    await repo.updateCert(tx, id, ctx.tenantId, {
      status: "renewed", validFrom, validTo: body.validTo, payloadHash: hash, signature, updatedBy: ctx.actorId,
    });
    await repo.insertEvent(tx, {
      tenantId: ctx.tenantId, certificateId: id, eventType: "renew",
      note: body.note ?? `Renewed to ${body.validTo}`, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "issuance_renew", id);
    return { id, status: "renewed", validTo: body.validTo };
  });
}

/** Cancel or revoke — terminal, verification will report the cert invalid. */
export async function revokeCertificate(ctx: RequestContext, id: string, body: RevokeBody): Promise<{ id: string; status: string }> {
  return db.transaction(async (tx) => {
    const cert = await repo.findCertByIdTx(tx, id, ctx.tenantId);
    if (!cert) throw new HttpError(404, "NOT_FOUND", "certificate not found");
    if (["cancelled", "revoked"].includes(cert.status)) throw new HttpError(409, "ALREADY_TERMINATED", `certificate is ${cert.status}`);
    const status = body.action === "cancel" ? "cancelled" : "revoked";
    await repo.updateCert(tx, id, ctx.tenantId, { status, updatedBy: ctx.actorId });
    await repo.insertEvent(tx, {
      tenantId: ctx.tenantId, certificateId: id, eventType: body.action,
      note: body.reason ?? status, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.certificateRevoked, eventType: EVENTS.certificateRevoked,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { id, certNo: cert.certNo, status },
    });
    await audit(tx, ctx, `issuance_${body.action}`, id);
    return { id, status };
  });
}
