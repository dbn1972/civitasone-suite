import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import {
  digiLockerFetch, isDigiLockerConfigured,
  defaultDigiLockerProvider, type DigiLockerProvider,
} from "./domain.js";
import { newPkceMaterial } from "./oauth.js";
import { configuredTrustStore, verifyPkcs7Document } from "./verify.js";
import {
  buildStorageKey, keyBelongsToCaller, objectExists, validateUpload,
  presignedPutUrl, PUT_URL_TTL_SECONDS, DOCUMENT_UPLOAD_LIMITS,
} from "./storage.js";
import type {
  UploadBody, PresignBody, DigilockerFetchBody, VerifyBody, ResubmitBody,
  AuthorizeBody, CallbackBody,
} from "./validators.js";

/** OAuth state TTL (10 min): the consent redirect must complete promptly. */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export type Accepted = { id: string; status: string; correlationId: string };

export interface PresignResult {
  uploadUrl: string;
  method: "PUT";
  key: string;
  expiresIn: number;
  maxSizeMb: number;
  headers: Record<string, string>;
}

/**
 * GAP-CITIZEN-DOCUMENTS-01: mint a short-lived SigV4 presigned PUT URL for a
 * direct browser→storage upload. Size + content-type are validated here and the
 * byte length is signed into the URL, so the object store rejects any body of a
 * different size. Throws a 400 HttpError on a disallowed type/size.
 */
export async function presignUpload(ctx: RequestContext, body: PresignBody): Promise<PresignResult> {
  const invalid = validateUpload({ filename: body.filename, contentType: body.contentType, sizeBytes: body.sizeBytes });
  if (invalid) throw new HttpError(400, invalid.code, invalid.message);
  const key = buildStorageKey(ctx.tenantId, ctx.actorId, body.filename);
  const uploadUrl = await presignedPutUrl({
    key,
    contentType: body.contentType,
    contentLength: body.sizeBytes,
    expiresIn: PUT_URL_TTL_SECONDS,
    serverSideEncryption: "AES256",
  });
  return {
    uploadUrl,
    method: "PUT",
    key,
    expiresIn: PUT_URL_TTL_SECONDS,
    maxSizeMb: DOCUMENT_UPLOAD_LIMITS.maxSizeMb,
    headers: { "Content-Type": body.contentType, "x-amz-server-side-encryption": "AES256" },
  };
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
  // GAP-CITIZEN-DOCUMENTS-01: the storageKey MUST be a key this caller presigned
  // (tenant+actor namespaced). Reject a forged/foreign key so a document can only
  // reference an object the uploader actually PUT. The bytes are never in the DB.
  if (!keyBelongsToCaller(body.storageKey, ctx.tenantId, ctx.actorId)) {
    throw new HttpError(400, "INVALID_STORAGE_KEY", "storageKey was not presigned by this caller");
  }
  // The key must also reference an object that was actually PUT to the store.
  if (!(await objectExists(body.storageKey))) {
    throw new HttpError(400, "OBJECT_NOT_UPLOADED", "no uploaded object exists for storageKey");
  }
  const id = randomUUID();
  return publish(ctx, COMMANDS.documentUpload, id, {
    id,
    applicationId: body.applicationId ?? null,
    citizenId: body.citizenId ?? null,
    serviceId: body.serviceId ?? null,
    docType: body.docType,
    storageRef: body.storageKey,
  });
}

/** DigiLocker-style fetch intake. */
export async function digilockerFetchIntake(ctx: RequestContext, body: DigilockerFetchBody): Promise<Accepted> {
  const id = randomUUID();
  // GAP-CITIZEN-DOCUMENTS-02 (DPDP): a real provider fetch pulls the citizen's
  // document, so it MUST be backed by a LIVE, persisted consent record — not
  // merely a client-sent boolean. Fail closed: reject a configured-provider
  // fetch unless a non-expired, non-revoked consent row exists for this
  // (tenant, citizen, docType). (Unconfigured stays honest below.)
  if (isDigiLockerConfigured()) {
    const citizenId = body.citizenId ?? ctx.actorId;
    const consent = await repo.findLiveConsent(ctx.tenantId, citizenId, body.docType);
    if (!consent) {
      throw new HttpError(
        422, "CONSENT_REQUIRED",
        "a live DigiLocker consent record is required before a document can be fetched",
      );
    }
  }
  const result = digiLockerFetch(body.docUri);
  return publish(ctx, COMMANDS.documentDigilockerFetch, id, {
    id,
    applicationId: body.applicationId ?? null,
    citizenId: body.citizenId ?? null,
    serviceId: body.serviceId ?? null,
    docType: body.docType,
    docUri: body.docUri,
    consent: body.consent ?? false,
    digilockerRef: result.digilockerRef,
    providerStatus: result.providerStatus,
    configured: result.configured,
    verificationStatus: result.configured ? "verified" : "pending",
    status: result.configured ? "verified" : "received",
    authenticity: result.authenticity,
  });
}

/**
 * GAP-CITIZEN-DOCUMENTS-02 — begin the DigiLocker OAuth consent redirect.
 * Mints PKCE + an opaque state bound server-side to {tenant, actor, citizen,
 * docType, purpose} with a TTL, stores it, and returns the provider authorize
 * URL. Fail-closed: when the provider is unconfigured there is no authorize URL
 * (honest 409), never a fabricated redirect.
 */
export async function beginDigiLockerAuthorize(
  ctx: RequestContext, body: AuthorizeBody,
  provider: DigiLockerProvider = defaultDigiLockerProvider,
): Promise<{ authorizeUrl: string; state: string; expiresAt: string }> {
  if (!provider.isConfigured()) {
    throw new HttpError(409, "PROVIDER_UNCONFIGURED", "DigiLocker provider is not configured");
  }
  const { state, codeVerifier, codeChallenge } = newPkceMaterial();
  const url = provider.authorizeUrl({ docType: body.docType, redirectUri: body.redirectUri, state, codeChallenge });
  if (!url) throw new HttpError(409, "PROVIDER_UNCONFIGURED", "DigiLocker provider is not configured");
  const citizenId = body.citizenId ?? ctx.actorId;
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);
  await repo.insertOauthState({
    state, tenantId: ctx.tenantId, actorId: ctx.actorId, citizenId,
    docType: body.docType, purpose: body.purpose, scope: "avs_parent_file",
    codeVerifier, codeChallenge, redirectUri: body.redirectUri,
    applicationId: body.applicationId ?? null, serviceId: body.serviceId ?? null,
    expiresAt,
  });
  return { authorizeUrl: url, state, expiresAt: expiresAt.toISOString() };
}

/**
 * GAP-CITIZEN-DOCUMENTS-02 — handle the OAuth callback. Re-binds the exchange
 * to the ORIGINAL state row (anti-CSRF/fixation: the state must belong to this
 * tenant, be unexpired, unconsumed, and begun by this actor), exchanges the
 * code via the provider (with the server-held PKCE verifier), verifies the
 * issued-document artefact (PKCS#7 structure + signer cert validity + chain to
 * the configured trust store) and ONLY THEN records a consent + a source-verified
 * submission. Any failure fails closed: no consent, no verified document.
 */
export async function digilockerCallback(
  ctx: RequestContext, body: CallbackBody,
  provider: DigiLockerProvider = defaultDigiLockerProvider,
): Promise<Accepted & { data: { id: string; verified: boolean; providerStatus: string } }> {
  const st = await repo.findOauthState(body.state, ctx.tenantId);
  if (!st) throw new HttpError(400, "INVALID_STATE", "unknown or foreign OAuth state");
  if (st.consumedAt) throw new HttpError(409, "STATE_CONSUMED", "this OAuth state was already used");
  if (st.expiresAt.getTime() < Date.now()) throw new HttpError(410, "STATE_EXPIRED", "OAuth state has expired");
  if (st.actorId !== ctx.actorId) throw new HttpError(403, "FORBIDDEN", "OAuth state belongs to a different actor");

  const exchange = await provider.exchangeCode({
    code: body.code, codeVerifier: st.codeVerifier, redirectUri: st.redirectUri,
  });

  // Verify the issued-document artefact locally before trusting it. Fail-closed:
  // no artefact, no trust store, or a failed check ⇒ NOT source-verified.
  let verified = false;
  let verifyReason = exchange.ok ? "artefact_absent" : exchange.providerStatus;
  if (exchange.ok && exchange.artefact) {
    const store = configuredTrustStore();
    const res = verifyPkcs7Document(exchange.artefact.content, exchange.artefact.signatureDer, store);
    verified = res.verified;
    verifyReason = res.reason;
  }

  const id = randomUUID();
  const consentId = randomUUID();
  const consentTtlMs = body.consentTtlDays * 24 * 60 * 60 * 1000;
  await publish(ctx, COMMANDS.documentDigilockerCallback, id, {
    id,
    state: st.state,
    consentId,
    citizenId: st.citizenId,
    applicationId: st.applicationId,
    serviceId: st.serviceId,
    docType: st.docType,
    purpose: st.purpose,
    scope: st.scope,
    consentExpiresAt: new Date(Date.now() + consentTtlMs).toISOString(),
    docUri: exchange.docUri,
    providerStatus: exchange.providerStatus,
    exchangeOk: exchange.ok,
    verified,
    verifyReason,
  });
  return {
    id, status: "accepted", correlationId: ctx.correlationId,
    data: { id, verified, providerStatus: exchange.providerStatus },
  };
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
export async function resubmit(
  ctx: RequestContext, id: string, body: ResubmitBody,
): Promise<Accepted & { supersedes: string; data: { id: string; supersedes: string } }> {
  const prior = await repo.findSubmissionById(id, ctx.tenantId);
  if (!prior) throw new HttpError(404, "NOT_FOUND", "document submission not found");
  if (prior.status !== "deficient" && prior.status !== "rejected") {
    throw new HttpError(409, "NOT_DEFICIENT", "only a deficient/rejected submission can be resubmitted");
  }
  const newId = randomUUID();
  const isDigi = body.source === "digilocker";
  // GAP-CITIZEN-DOCUMENTS-01: an upload-source resubmission must reference a
  // real object this caller presigned — no fabricated storage ref.
  if (!isDigi) {
    if (!body.storageKey) {
      throw new HttpError(400, "FILE_REQUIRED", "an upload resubmission requires a presigned storageKey");
    }
    if (!keyBelongsToCaller(body.storageKey, ctx.tenantId, ctx.actorId)) {
      throw new HttpError(400, "INVALID_STORAGE_KEY", "storageKey was not presigned by this caller");
    }
    if (!(await objectExists(body.storageKey))) {
      throw new HttpError(400, "OBJECT_NOT_UPLOADED", "no uploaded object exists for storageKey");
    }
  }
  const result = isDigi ? digiLockerFetch(body.docUri ?? prior.digilockerRef ?? "") : null;
  const accepted = await publish(ctx, COMMANDS.documentResubmit, newId, {
    id: newId,
    supersedesId: id,
    source: body.source,
    docUri: body.docUri ?? null,
    storageRef: isDigi ? null : (body.storageKey ?? null),
    digilockerRef: result?.digilockerRef ?? null,
    providerStatus: result?.providerStatus ?? null,
    configured: result?.configured ?? false,
    verificationStatus: result?.configured ? "verified" : "pending",
    status: result?.configured ? "verified" : "received",
    authenticity: result?.authenticity ?? (isDigi ? "unverified" : "self_attested"),
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "document", id));
  // `acceptedResponseSchema` (packages/schemas/common.ts) only declares
  // {id, status, correlationId, data:{id}.passthrough()} — any OTHER top-level
  // field silently gets stripped by sendAccepted()'s schema.parse(). `supersedes`
  // has to travel inside `data` (passthrough) to survive onto the wire; see
  // commit 62ed6fd4 (admin F3 envelope fix) for the same bug in another service.
  return { ...accepted, supersedes: id, data: { id: accepted.id, supersedes: id } };
}
