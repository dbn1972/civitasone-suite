import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { loadSettingsTx } from "../approvals/repo.js";
import type { BankFileRow } from "../integrations/bank-file-generator.js";
import { sendNachFile } from "../integrations/nach-release.js";
import * as repo from "./repo.js";
import { verifyStoredSignature } from "./dsc-batch.js";
import { isProductionDeployment } from "./dsc-client.js";
import { currentBatchDigest, storedSignatureOf } from "./consumer.js";

const log = pino({ name: "finance.pfms.release" });
const AUDIT_TOPIC = "audit.event.record";

type PfmsRow = NonNullable<Awaited<ReturnType<typeof repo.findPfmsById>>>;
type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };

/** States in which the batch has already been handed over (or is being): a release is then an idempotent no-op. */
export const SENT_STATES = ["processing", "file_sent", "submitted", "accepted", "completed"] as const;

export type ReleaseRefusal = { ok: false; status: number; code: string; message: string };

/**
 * Whether a signed batch may be released NOW, by this actor. Read-only and shared by the route (immediate 4xx) and the
 * consumer (authoritative), so they can never disagree. Fails closed:
 *   - the batch must be signed with a complete DSC signature (UNSIGNED_BATCH);
 *   - in production a sandbox (mock) signature is refused (MOCK_SIGNATURE);
 *   - the stored signature is re-verified against the batch as it stands now (BATCH_CHANGED_AFTER_SIGNING, ...);
 *   - maker != checker: when the tenant's finance maker-checker setting is on (default), the releaser must differ from the
 *     user who initiated the batch (MAKER_CHECKER_VIOLATION).
 */
export async function checkReleasable(batch: PfmsRow, actorId: string, makerCheckerEnabled: boolean): Promise<{ ok: true } | ReleaseRefusal> {
  if (batch.channel !== "treasury_batch") {
    return { ok: false, status: 400, code: "INVALID_CHANNEL", message: "release is only applicable to treasury batch submissions" };
  }
  if (batch.submissionStatus !== "signed" || !batch.dscSignature) {
    return { ok: false, status: 409, code: "UNSIGNED_BATCH", message: "the batch must be DSC-signed before it can be released" };
  }
  if (makerCheckerEnabled && batch.createdBy === actorId) {
    return { ok: false, status: 403, code: "MAKER_CHECKER_VIOLATION", message: "the user who initiated this batch cannot also release it (maker-checker)" };
  }
  if (isProductionDeployment() && batch.dscMock) {
    return { ok: false, status: 409, code: "MOCK_SIGNATURE", message: "a sandbox (mock) signature cannot release a batch in production" };
  }
  const { digest } = await currentBatchDigest(batch);
  const v = verifyStoredSignature(storedSignatureOf(batch), digest, batch.pfmsId);
  if (!v.ok) return { ok: false, status: 409, code: v.code, message: v.message };
  return { ok: true };
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: Msg, action: string, id: string, outcome: "success" | "failure" | "denied", details: Record<string, unknown>) {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType: "pfms_batch", resourceId: id, outcome, details },
  });
}

/** A refusal retrying cannot fix: audited, message consumed, batch untouched. */
async function refuse(msg: Msg, id: string, code: string, message: string, outcome: "failure" | "denied" = "denied"): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await audit(tx, msg, "release", id, outcome, { code, message });
  });
  log.warn({ id, code }, `pfms.batch_release refused: ${message}`);
}

export function registerPfmsReleaseConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.pfmsBatchRelease, async (rawMsg) => {
    const msg = rawMsg as unknown as Msg;
    const p = msg.payload as { id: string; tenantId: string };
    const batch = await repo.findPfmsById(p.id, p.tenantId);
    if (!batch) { await refuse(msg, p.id, "NOT_FOUND", `PFMS batch ${p.id} not found`, "failure"); return; }

    // Already sent (or being sent): idempotent no-op, audited. Never a second send.
    if ((SENT_STATES as readonly string[]).includes(batch.submissionStatus)) {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await audit(tx, msg, "release_skipped", p.id, "success", { reason: `batch is already ${batch.submissionStatus}` });
      });
      return;
    }

    const settings = await db.transaction((tx) => loadSettingsTx(tx, p.tenantId));
    const check = await checkReleasable(batch, msg.actorId, settings.makerCheckerEnabled);
    if (!check.ok) { await refuse(msg, p.id, check.code, check.message); return; }

    // Single-sender claim: signed -> processing in one guarded UPDATE with the idempotency marker and an audit row.
    const claimed = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return null;
      const row = await repo.claimPfmsRelease(tx, p.id, p.tenantId, msg.actorId);
      if (!row) {
        await audit(tx, msg, "release_skipped", p.id, "success", { reason: "lost the release race; another request is sending or has sent this batch" });
        return null;
      }
      await audit(tx, msg, "release_claimed", p.id, "success", { certificateSerial: row.dscCertSerial, mock: row.dscMock });
      return row;
    });
    if (!claimed) return;

    // The send runs OUTSIDE any transaction, through the same NACH + SFTP path as EFT-initiate.
    let failure: { code: string; message: string } | null = null;
    let beneficiaryCount = 0;
    try {
      const beneficiaries = await repo.listRealBeneficiaries(p.tenantId, batch.pfmsId, 20001);
      beneficiaryCount = beneficiaries.length;
      if (beneficiaries.length === 0) {
        failure = { code: "NO_BENEFICIARIES", message: "the batch has no payments to put in a bank file" };
      } else {
        const date = new Date().toISOString().slice(0, 10);
        const rows: BankFileRow[] = beneficiaries.map((b) => ({
          ifsc: b.ifsc, accountNo: b.account, accountName: b.beneficiary || "Unknown beneficiary", amountMinor: b.amountMinor,
          narration: `${batch.type}/${batch.pfmsId}`.slice(0, 25), paymentDate: date,
        }));
        const path = await sendNachFile({ pfmsBatchId: batch.id, agencyCode: batch.agencyCode ?? "", rows });
        // No SFTP configured = nothing was sent. Dev/test treats that as sent (same as EFT-initiate); production does not.
        if (path === null && isProductionDeployment()) failure = { code: "SFTP_NOT_CONFIGURED", message: "the PFMS SFTP gateway is not configured; nothing was sent" };
      }
    } catch (err) {
      log.error({ err, id: p.id }, "PFMS release upload failed");
      failure = { code: "SEND_FAILED", message: "the file could not be delivered to the PFMS gateway" };
    }

    await db.transaction(async (tx) => {
      const row = await repo.finishPfmsRelease(tx, p.id, p.tenantId, msg.actorId, failure ? "signed" : "file_sent");
      if (!row) {
        await audit(tx, msg, "release", p.id, "failure", { code: "STATE_CHANGED", message: "the batch left the processing state while sending" });
        return;
      }
      if (failure) {
        await audit(tx, msg, "release", p.id, "failure", { ...failure, reverted: "signed" });
        return;
      }
      await enqueue(tx, {
        topic: "finance.pfms.batch_released", eventType: "finance.pfms.batch_released",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { batchId: p.id, beneficiaryCount },
      });
      await audit(tx, msg, "release", p.id, "success", { beneficiaryCount, mock: row.dscMock, certificateSerial: row.dscCertSerial });
    });
    await cache.invalidateResource(msg.tenantId, "pfms");
  });
}
