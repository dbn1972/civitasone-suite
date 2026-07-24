import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as catalogueRepo from "../catalogue/repo.js";
import * as portalRepo from "../portal/repo.js";
import { digiLockerFetch, computeChecklist, verificationTransition } from "./domain.js";
import type { UploadBody, DigilockerFetchBody, VerifyBody, ResubmitBody } from "./validators.js";

async function audit(tx: Parameters<typeof enqueue>[0], ctx: RequestContext, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "citizen", action, resourceType: "document_submission", resourceId, outcome: "success" },
  });
}

/** Pre-signed object ref — binary never stored in the DB. */
function storageRef(tenantId: string, docId: string, docType: string): string {
  return `https://s3.example.com/${tenantId}/documents/${docId}/${docType}?expires=${Date.now() + 60 * 60 * 1000}`;
}

/** Upload-intake: record a self-attested document submission (pending verification). */
export async function upload(ctx: RequestContext, body: UploadBody): Promise<{ id: string; status: string; verificationStatus: string }> {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await repo.insertSubmission(tx, {
      id, tenantId: ctx.tenantId, applicationId: body.applicationId ?? null,
      citizenId: body.citizenId ?? null, serviceId: body.serviceId ?? null,
      docType: body.docType, source: "upload", storageRef: storageRef(ctx.tenantId, id, body.docType),
      status: "received", verificationStatus: "pending", authenticity: "self_attested",
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "upload", id);
  });
  return { id, status: "received", verificationStatus: "pending" };
}

/**
 * DigiLocker-style fetch intake. Env-gated + honest: with no provider creds the
 * submission is recorded pending with providerStatus 'provider_unconfigured'
 * (never a fake source-verified success).
 */
export async function digilockerFetchIntake(ctx: RequestContext, body: DigilockerFetchBody): Promise<{
  id: string; configured: boolean; providerStatus: string; verificationStatus: string; authenticity: string;
}> {
  const id = randomUUID();
  const result = digiLockerFetch(body.docUri);
  const verificationStatus = result.configured ? "verified" : "pending";
  const status = result.configured ? "verified" : "received";
  await db.transaction(async (tx) => {
    await repo.insertSubmission(tx, {
      id, tenantId: ctx.tenantId, applicationId: body.applicationId ?? null,
      citizenId: body.citizenId ?? null, serviceId: body.serviceId ?? null,
      docType: body.docType, source: "digilocker", digilockerRef: result.digilockerRef,
      providerStatus: result.providerStatus, status, verificationStatus, authenticity: result.authenticity,
      ...(result.configured ? { verifiedBy: ctx.actorId, verifiedAt: new Date() } : {}),
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    if (result.configured) {
      await enqueue(tx, {
        topic: EVENTS.documentVerified, eventType: EVENTS.documentVerified,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { id, docType: body.docType, source: "digilocker", authenticity: result.authenticity },
      });
    }
    await audit(tx, ctx, "digilocker_fetch", id);
  });
  return { id, configured: result.configured, providerStatus: result.providerStatus, verificationStatus, authenticity: result.authenticity };
}

/** Officer verification decision (verify / reject / deficiency memo). */
export async function verify(ctx: RequestContext, id: string, body: VerifyBody): Promise<{ id: string; status: string; verificationStatus: string }> {
  return db.transaction(async (tx) => {
    const sub = await repo.findSubmissionByIdTx(tx, id, ctx.tenantId);
    if (!sub) throw new HttpError(404, "NOT_FOUND", "document submission not found");
    if (sub.status === "superseded") throw new HttpError(409, "SUPERSEDED", "submission was superseded by a resubmission");
    if (body.decision === "deficient" && (!body.reason || body.reason.trim().length === 0)) {
      throw new HttpError(422, "DEFICIENCY_REASON_REQUIRED", "a deficiency memo requires a reason");
    }
    const t = verificationTransition(body.decision);
    await repo.updateSubmission(tx, id, ctx.tenantId, {
      status: t.status, verificationStatus: t.verificationStatus,
      ...(t.authenticity ? { authenticity: t.authenticity } : {}),
      deficiencyReason: body.decision === "deficient" ? (body.reason ?? null) : null,
      verifiedBy: ctx.actorId, verifiedAt: new Date(), updatedBy: ctx.actorId,
    });
    if (body.decision === "verify") {
      await enqueue(tx, {
        topic: EVENTS.documentVerified, eventType: EVENTS.documentVerified,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { id, docType: sub.docType, applicationId: sub.applicationId, source: sub.source },
      });
    }
    await audit(tx, ctx, `verify_${body.decision}`, id);
    return { id, status: t.status, verificationStatus: t.verificationStatus };
  });
}

/**
 * Resubmission cycle — a new submission that supersedes a deficient one. The
 * deficient submission is marked 'superseded' so the checklist counts only the
 * fresh document.
 */
export async function resubmit(ctx: RequestContext, id: string, body: ResubmitBody): Promise<{ id: string; supersedes: string; status: string }> {
  const newId = randomUUID();
  await db.transaction(async (tx) => {
    const prior = await repo.findSubmissionByIdTx(tx, id, ctx.tenantId);
    if (!prior) throw new HttpError(404, "NOT_FOUND", "document submission not found");
    if (prior.status !== "deficient" && prior.status !== "rejected") {
      throw new HttpError(409, "NOT_DEFICIENT", "only a deficient/rejected submission can be resubmitted");
    }
    const isDigi = body.source === "digilocker";
    const result = isDigi ? digiLockerFetch(body.docUri ?? prior.digilockerRef ?? "") : null;
    await repo.insertSubmission(tx, {
      id: newId, tenantId: ctx.tenantId, applicationId: prior.applicationId,
      citizenId: prior.citizenId, serviceId: prior.serviceId, docType: prior.docType,
      source: body.source, supersedesId: id,
      storageRef: isDigi ? null : storageRef(ctx.tenantId, newId, prior.docType),
      digilockerRef: result?.digilockerRef ?? null, providerStatus: result?.providerStatus ?? null,
      status: result?.configured ? "verified" : "received",
      verificationStatus: result?.configured ? "verified" : "pending",
      authenticity: result?.authenticity ?? (isDigi ? "unverified" : "self_attested"),
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await repo.updateSubmission(tx, id, ctx.tenantId, { status: "superseded", updatedBy: ctx.actorId });
    await audit(tx, ctx, "resubmit", newId);
  });
  return { id: newId, supersedes: id, status: "received" };
}

/**
 * Required-document checklist for a service, folding in the citizen's actual
 * submissions. The required list comes from the published SVC-081 catalogue
 * definition (by serviceId); if none is published it falls back to the portal
 * service's requiredDocs.
 */
export async function checklist(ctx: RequestContext, serviceId: string, applicationId?: string): Promise<{
  source: string; items: unknown[]; complete: boolean;
}> {
  return db.transaction(async (tx) => {
    const def = await catalogueRepo.findPublishedByServiceIdTx(tx, ctx.tenantId, serviceId);
    let required: Array<{ docType: string; label?: string | undefined; mandatory: boolean }>;
    let source: string;
    if (def) {
      required = def.requiredDocuments.map((d) => ({ docType: d.docType, label: d.label, mandatory: d.mandatory }));
      source = "catalogue";
    } else {
      const svc = await portalRepo.findServiceByIdTx(tx, serviceId, ctx.tenantId);
      required = (svc?.requiredDocs ?? []).map((docType) => ({ docType, mandatory: true }));
      source = "portal_service";
    }
    const subs = applicationId ? await repo.listByApplicationTx(tx, ctx.tenantId, applicationId) : [];
    const { items, complete } = computeChecklist(required, subs);
    return { source, items, complete };
  });
}
