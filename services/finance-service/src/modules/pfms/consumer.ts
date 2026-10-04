import { pino } from "pino";
import { NotImplementedError, type DscSignResult } from "@civitasone/connector-framework/ports";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import {
  CANONICAL_VERSION, SIG_RSA_SHA256, batchDigestHex, buildSignedInfo, buildXmlDsig, canonicalizeBatch, sha256Hex,
  verifyStoredSignature, type StoredSignature, type VerifyResult,
} from "./dsc-batch.js";
import { DscChannelError, isProductionDeployment, resolveDscSigner } from "./dsc-client.js";

const log = pino({ name: "finance.pfms.consumer" });
const AUDIT_TOPIC = "audit.event.record";
/** A batch with more beneficiaries than this is refused rather than hashed over a truncated set. */
export const MAX_BATCH_BENEFICIARIES = 20000;

type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };
type PfmsRow = NonNullable<Awaited<ReturnType<typeof repo.findPfmsById>>>;

/** Canonical digest of the batch as it stands now (header row + its real beneficiaries). Reads outside any open transaction. */
export async function currentBatchDigest(batch: PfmsRow): Promise<{ canonical: string; digest: string; beneficiaryCount: number }> {
  const beneficiaries = await repo.listRealBeneficiaries(batch.tenantId, batch.pfmsId, MAX_BATCH_BENEFICIARIES + 1);
  if (beneficiaries.length > MAX_BATCH_BENEFICIARIES) {
    throw new DscChannelError("DSC_SIGN_REJECTED", `batch has more than ${MAX_BATCH_BENEFICIARIES} beneficiaries; split it before signing`, true);
  }
  const canonical = canonicalizeBatch(
    {
      tenantId: batch.tenantId, pfmsId: batch.pfmsId, type: batch.type, currency: batch.currency,
      agencyCode: batch.agencyCode, schemeCode: batch.schemeCode, ddoCode: batch.ddoCode, amountMinor: batch.amountMinor,
    },
    beneficiaries.map((b) => ({ ref: b.ref, beneficiary: b.beneficiary, account: b.account, ifsc: b.ifsc, amountMinor: b.amountMinor, ddoCode: b.ddoCode })),
  );
  return { canonical, digest: batchDigestHex(canonical), beneficiaryCount: beneficiaries.length };
}

export const storedSignatureOf = (b: PfmsRow): StoredSignature => ({
  batchDigest: b.batchDigest, signedInfoHash: b.signedInfoHash, signature: b.dscSignature, algorithm: b.dscAlgorithm,
  signatureMethod: b.dscSignatureMethod, certSerial: b.dscCertSerial, signerRef: b.dscSignerRef, canonicalVersion: b.dscCanonicalVersion,
});

/**
 * Production egress gate. In a production deployment a batch may be released only when it carries a complete,
 * REAL (non-mock) DSC signature that verifies against the batch as it stands now. Outside production this
 * returns ok (sandbox flows stay usable, and a mock signature is labelled as such everywhere).
 */
export async function checkBatchSendable(batch: PfmsRow): Promise<{ ok: true; verify: VerifyResult | null } | { ok: false; code: string; message: string }> {
  if (!isProductionDeployment()) return { ok: true, verify: null };
  if (!batch.dscSignature) return { ok: false, code: "UNSIGNED_BATCH", message: "an unsigned batch cannot be sent in production" };
  if (batch.dscMock) return { ok: false, code: "MOCK_SIGNATURE", message: "a sandbox (mock) signature cannot release a batch in production" };
  const { digest } = await currentBatchDigest(batch);
  const v = verifyStoredSignature(storedSignatureOf(batch), digest, batch.pfmsId);
  return v.ok ? { ok: true, verify: v } : { ok: false, code: v.code, message: v.message };
}

async function auditStep(
  tx: Parameters<typeof enqueue>[0], msg: Msg, action: string, resourceId: string,
  outcome: "success" | "failure" | "denied", details: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType: "pfms_batch", resourceId, outcome, details },
  });
}

/** Record a failed step in its own transaction (never rolled back with the work it describes). */
async function auditFailure(msg: Msg, action: string, id: string, code: string, message: string, extra: Record<string, unknown> = {}): Promise<void> {
  await db.transaction(async (tx) => { await auditStep(tx, msg, action, id, "failure", { code, message, ...extra }); });
}

export function registerPfmsConsumers(queue: Queue): void {
  queue.subscribe("finance.pfms.batch_sign", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason?: string };
    const m = msg as unknown as Msg;

    // Pre-checks outside the transaction (the signer call below is a network call and must never run inside one).
    const batch = await repo.findPfmsById(p.id, p.tenantId);
    if (!batch) { await permanent(m, "sign", p.id, "NOT_FOUND", `PFMS batch ${p.id} not found`); return; }
    if (batch.submissionStatus !== "pending") {
      // Idempotent: a redelivery or a second request for an already-signed / sent batch is a no-op, never a second signature.
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await auditStep(tx, m, "sign_skipped", p.id, "success", { reason: `batch is already ${batch.submissionStatus}` });
      });
      return;
    }

    let signed: { result: DscSignResult; digest: string; signedInfoHash: string; xmldsig: string; signatureMethod: string; providerKey: string; environment: "sandbox" | "production"; mock: boolean; signerRef: string; beneficiaryCount: number };
    try {
      const { digest, beneficiaryCount } = await currentBatchDigest(batch);
      const resolved = await resolveDscSigner(p.tenantId);
      const signatureMethod = SIG_RSA_SHA256;
      const signedInfo = buildSignedInfo({ digestHex: digest, pfmsId: batch.pfmsId, signatureMethod });
      const signedInfoHash = sha256Hex(signedInfo);
      let result: DscSignResult;
      try {
        result = await resolved.signer.sign({ payloadHashSha256: signedInfoHash, signerRef: resolved.signerRef, reason: p.reason ?? `PFMS batch ${batch.pfmsId} signing` });
      } catch (err) {
        if (err instanceof NotImplementedError) {
          throw new DscChannelError("DSC_PRODUCTION_UNAVAILABLE", "the production DSC signing channel is not available yet (configured for UAT)", true);
        }
        const code = (err as { code?: string }).code;
        // Auth / provider rejection will not succeed on retry; a timeout may.
        if (code === "AUTH_FAILED" || code === "PROVIDER_REJECTED" || code === "INVALID_HASH") {
          throw new DscChannelError("DSC_SIGN_REJECTED", `the DSC signer refused the request (${code})`, true);
        }
        throw new DscChannelError("DSC_CONFIG_UNAVAILABLE", `the DSC signer did not respond (${code ?? "error"})`, false);
      }
      const xmldsig = buildXmlDsig({ signedInfo, signatureBase64: result.signatureBase64, certificateSerial: result.certificateSerial });
      signed = { result, digest, signedInfoHash, xmldsig, signatureMethod, providerKey: resolved.providerKey, environment: resolved.environment, mock: resolved.mock, signerRef: resolved.signerRef, beneficiaryCount };
    } catch (err) {
      if (err instanceof DscChannelError) {
        if (err.permanent) { await permanent(m, "sign", p.id, err.code, err.message); return; }
        await auditFailure(m, "sign", p.id, err.code, err.message, { retryable: true });
      }
      throw err;
    }

    // One transaction: idempotency marker + guarded UPDATE + domain event + audit. The WHERE pins
    // submission_status = 'pending' AND no signature yet, so of two concurrent signers exactly one persists.
    const applied = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return "duplicate" as const;
      const row = await repo.signPfmsBatchGuarded(tx, p.id, p.tenantId, {
        signedAt: new Date(signed.result.signedAt), signedBy: msg.actorId,
        signatureRef: `DSC:${signed.result.certificateSerial}:${signed.signedInfoHash.slice(0, 16)}`,
        batchDigest: signed.digest, signedInfoHash: signed.signedInfoHash, dscSignature: signed.result.signatureBase64,
        dscAlgorithm: signed.result.algorithm, dscSignatureMethod: signed.signatureMethod, dscCertSerial: signed.result.certificateSerial,
        dscSignerRef: signed.signerRef, dscProviderKey: signed.providerKey, dscEnvironment: signed.environment, dscMock: signed.mock,
        dscCanonicalVersion: CANONICAL_VERSION, dscXmldsig: signed.xmldsig, updatedBy: msg.actorId,
      });
      if (!row) {
        await auditStep(tx, m, "sign_skipped", p.id, "success", { reason: "lost the signing race; the batch was signed by another request" });
        return "lost" as const;
      }
      await enqueue(tx, {
        topic: "finance.pfms.batch_signed", eventType: "finance.pfms.batch_signed",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { batchId: p.id, certificateSerial: signed.result.certificateSerial, mock: signed.mock },
      });
      await auditStep(tx, m, "sign", p.id, "success", {
        certificateSerial: signed.result.certificateSerial, algorithm: signed.result.algorithm, signerRef: signed.signerRef,
        providerKey: signed.providerKey, environment: signed.environment, mock: signed.mock,
        batchDigest: signed.digest, signedInfoHash: signed.signedInfoHash, canonicalVersion: CANONICAL_VERSION, beneficiaryCount: signed.beneficiaryCount,
      });
      return "signed" as const;
    });
    await cache.invalidateResource(msg.tenantId, "pfms");
    log.info({ id: msg.messageId, applied }, "Processed pfms.batch_sign");
  });

  queue.subscribe("finance.pfms.batch_submit", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    const m = msg as unknown as Msg;
    const batch = await repo.findPfmsById(p.id, p.tenantId);
    if (!batch) { await permanent(m, "submit", p.id, "NOT_FOUND", `PFMS batch ${p.id} not found`); return; }
    if (batch.submissionStatus === "submitted") {
      await db.transaction(async (tx) => { await markProcessed(tx, msg.messageId); });
      return; // idempotent
    }
    if (batch.submissionStatus !== "signed") {
      await permanent(m, "submit", p.id, "UNSIGNED_BATCH", `PFMS batch ${p.id} must be signed before submission`);
      return;
    }
    // Verify the STORED signature against the batch as it stands now, before anything is released.
    const { digest } = await currentBatchDigest(batch);
    const verdict = verifyStoredSignature(storedSignatureOf(batch), digest, batch.pfmsId);
    if (!verdict.ok) { await permanent(m, "submit", p.id, verdict.code, verdict.message, { stage: "verify" }); return; }
    if (isProductionDeployment() && verdict.mock) {
      await permanent(m, "submit", p.id, "MOCK_SIGNATURE", "a sandbox (mock) signature cannot release a batch in production", { stage: "verify" });
      return;
    }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.submitPfmsBatchGuarded(tx, p.id, p.tenantId, msg.actorId);
      if (!row) {
        await auditStep(tx, m, "submit_skipped", p.id, "success", { reason: "batch is no longer in the signed state" });
        return;
      }
      await enqueue(tx, {
        topic: "finance.pfms.batch_submitted", eventType: "finance.pfms.batch_submitted",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { batchId: p.id },
      });
      await auditStep(tx, m, "verify_signature", p.id, "success", { method: verdict.method, mock: verdict.mock, certificateSerial: batch.dscCertSerial });
      await auditStep(tx, m, "submit", p.id, "success", { mock: verdict.mock });
    });
    await cache.invalidateResource(msg.tenantId, "pfms");
    log.info({ id: msg.messageId }, "Processed pfms.batch_submit");
  });
}

/** A refusal that retrying cannot fix: audited as a failure, the message is consumed, the batch is left untouched. */
async function permanent(msg: Msg, action: string, id: string, code: string, message: string, extra: Record<string, unknown> = {}): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await auditStep(tx, msg, action, id, "failure", { code, message, ...extra });
  });
  log.warn({ id, code }, `pfms.batch_${action} refused: ${message}`);
}
