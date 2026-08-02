import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { digiLockerFetch } from "./domain.js";
import type { UploadBody, DigilockerFetchBody, VerifyBody, ResubmitBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** Pre-signed object ref — binary never stored in the DB. */
function storageRef(tenantId: string, docId: string, docType: string): string {
  return `https://s3.example.com/${tenantId}/documents/${docId}/${docType}?expires=${Date.now() + 60 * 60 * 1000}`;
}

async function publish(
  ctx: RequestContext, type: string, messageId: string, payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, tenantId: ctx.tenantId },
  });
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}

/** Upload-intake: record a self-attested document submission (pending verification). */
export async function upload(ctx: RequestContext, body: UploadBody): Promise<Accepted> {
  const id = randomUUID();
  return publish(ctx, COMMANDS.documentUpload, id, {
    id,
    applicationId: body.applicationId ?? null,
    citizenId: body.citizenId ?? null,
    serviceId: body.serviceId ?? null,
    docType: body.docType,
    storageRef: storageRef(ctx.tenantId, id, body.docType),
  });
}

/** DigiLocker-style fetch intake. */
export async function digilockerFetchIntake(ctx: RequestContext, body: DigilockerFetchBody): Promise<Accepted> {
  const id = randomUUID();
  const result = digiLockerFetch(body.docUri);
  return publish(ctx, COMMANDS.documentDigilockerFetch, id, {
    id,
    applicationId: body.applicationId ?? null,
    citizenId: body.citizenId ?? null,
    serviceId: body.serviceId ?? null,
    docType: body.docType,
    docUri: body.docUri,
    digilockerRef: result.digilockerRef,
    providerStatus: result.providerStatus,
    configured: result.configured,
    verificationStatus: result.configured ? "verified" : "pending",
    status: result.configured ? "verified" : "received",
    authenticity: result.authenticity,
  });
}

/** Officer verification decision (verify / reject / deficiency memo). */
export async function verify(ctx: RequestContext, id: string, body: VerifyBody): Promise<Accepted> {
  const sub = await repo.findSubmissionById(id, ctx.tenantId);
  if (!sub) throw new HttpError(404, "NOT_FOUND", "document submission not found");
  if (sub.status === "superseded") throw new HttpError(409, "SUPERSEDED", "submission was superseded by a resubmission");
  if (body.decision === "deficient" && (!body.reason || body.reason.trim().length === 0)) {
    throw new HttpError(422, "DEFICIENCY_REASON_REQUIRED", "a deficiency memo requires a reason");
  }
  const accepted = await publish(ctx, COMMANDS.documentVerify, randomUUID(), { id, ...body });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "document", id));
  return { ...accepted, id };
}

/** Resubmission cycle — a new submission that supersedes a deficient one. */
export async function resubmit(ctx: RequestContext, id: string, body: ResubmitBody): Promise<Accepted & { supersedes: string }> {
  const prior = await repo.findSubmissionById(id, ctx.tenantId);
  if (!prior) throw new HttpError(404, "NOT_FOUND", "document submission not found");
  if (prior.status !== "deficient" && prior.status !== "rejected") {
    throw new HttpError(409, "NOT_DEFICIENT", "only a deficient/rejected submission can be resubmitted");
  }
  const newId = randomUUID();
  const isDigi = body.source === "digilocker";
  const result = isDigi ? digiLockerFetch(body.docUri ?? prior.digilockerRef ?? "") : null;
  const accepted = await publish(ctx, COMMANDS.documentResubmit, newId, {
    id: newId,
    supersedesId: id,
    source: body.source,
    docUri: body.docUri ?? null,
    storageRef: isDigi ? null : storageRef(ctx.tenantId, newId, prior.docType),
    digilockerRef: result?.digilockerRef ?? null,
    providerStatus: result?.providerStatus ?? null,
    configured: result?.configured ?? false,
    verificationStatus: result?.configured ? "verified" : "pending",
    status: result?.configured ? "verified" : "received",
    authenticity: result?.authenticity ?? (isDigi ? "unverified" : "self_attested"),
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "document", id));
  return { ...accepted, supersedes: id };
}
