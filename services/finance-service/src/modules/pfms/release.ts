import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { loadSettingsTx } from "../approvals/repo.js";
import type { BankFileRow } from "../integrations/bank-file-generator.js";
import { releaseFileName, sendNachFile } from "../integrations/nach-release.js";
import * as repo from "./repo.js";
import { verifyStoredSignature } from "./dsc-batch.js";
import { isProductionDeployment } from "./dsc-client.js";
import { MAX_BATCH_BENEFICIARIES, currentBatchDigest, digestFor, storedSignatureOf } from "./consumer.js";

const log = pino({ name: "finance.pfms.release" });
const AUDIT_TOPIC = "audit.event.record";
/** Attributed to automatic actions (the sweeper): the same service-account id the internal auth path uses. */
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000099";

type PfmsRow = NonNullable<Awaited<ReturnType<typeof repo.findPfmsById>>>;
type Msg = { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: unknown };

/** States in which the batch has already been handed over (or is being, or may have been): a release is then an idempotent no-op. */
export const SENT_STATES = ["processing", "send_unknown", "file_sent", "submitted", "accepted", "completed"] as const;

export type Refusal = { ok: false; status: number; code: string; message: string };

/**
 * Whether a signed batch may be released NOW, by this actor. Read-only and shared by the route (immediate 4xx) and the
 * consumer (authoritative), so they can never disagree. Fails closed:
 *   - the batch must be signed with a complete DSC signature (UNSIGNED_BATCH);
 *   - in production a sandbox (mock) signature is refused (MOCK_SIGNATURE), by the stored flag AND by the verifier's verdict;
 *   - the stored signature is re-verified against the batch as it stands now (BATCH_CHANGED_AFTER_SIGNING, ...);
 *   - maker != checker: when the tenant's finance maker-checker setting is on (default), the releaser must differ from the
 *     user who initiated the batch (MAKER_CHECKER_VIOLATION).
 * The consumer ALSO re-checks the digest against the exact rows it sends, after the claim (see release below).
 */
export async function checkReleasable(batch: PfmsRow, actorId: string, makerCheckerEnabled: boolean): Promise<{ ok: true } | Refusal> {
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
  if (isProductionDeployment() && v.mock) {
    return { ok: false, status: 409, code: "MOCK_SIGNATURE", message: "a sandbox (mock) signature cannot release a batch in production" };
  }
  return { ok: true };
}

/** Maker != checker for the operator decisions below: the decider must differ from `otherParty` when the tenant setting is on. */
export function checkDistinct(makerCheckerEnabled: boolean, otherParty: string | null, actorId: string, what: string): { ok: true } | Refusal {
  if (makerCheckerEnabled && otherParty && otherParty === actorId) {
    return { ok: false, status: 403, code: "MAKER_CHECKER_VIOLATION", message: `${what} (maker-checker)` };
  }
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
async function refuse(msg: Msg, id: string, action: string, code: string, message: string, outcome: "failure" | "denied" = "denied"): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await audit(tx, msg, action, id, outcome, { code, message });
  });
  log.warn({ id, code }, `pfms ${action} refused: ${message}`);
}

export function registerPfmsReleaseConsumers(queue: Queue): void {
  // ── release ──────────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.pfmsBatchRelease, async (rawMsg) => {
    const msg = rawMsg as unknown as Msg;
    const p = msg.payload as { id: string; tenantId: string };
    const batch = await repo.findPfmsById(p.id, p.tenantId);
    if (!batch) { await refuse(msg, p.id, "release", "NOT_FOUND", `PFMS batch ${p.id} not found`, "failure"); return; }

    // Already sent / in flight / ambiguous: idempotent no-op, audited. Never a second send.
    if ((SENT_STATES as readonly string[]).includes(batch.submissionStatus)) {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await audit(tx, msg, "release_skipped", p.id, "success", { reason: `batch is already ${batch.submissionStatus}` });
      });
      return;
    }

    const settings = await db.transaction((tx) => loadSettingsTx(tx, p.tenantId));
    const check = await checkReleasable(batch, msg.actorId, settings.makerCheckerEnabled);
    if (!check.ok) { await refuse(msg, p.id, "release", check.code, check.message); return; }

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

    // The file is built from ONE read of the beneficiaries, taken AFTER the claim, and that same read is digested and
    // compared with the signed digest. So what is sent is exactly what was signed (no check-then-read gap), and a change
    // after the verification above is caught here. Header values come from the claimed row (the freshest read).
    let failure: { code: string; message: string } | null = null;
    let beneficiaryCount = 0;
    try {
      const beneficiaries = await repo.listRealBeneficiaries(p.tenantId, claimed.pfmsId, MAX_BATCH_BENEFICIARIES + 1);
      beneficiaryCount = beneficiaries.length;
      if (beneficiaries.length > MAX_BATCH_BENEFICIARIES) {
        failure = { code: "BATCH_TOO_LARGE", message: "the batch has more beneficiaries than can be released in one file" };
      } else if (beneficiaries.length === 0) {
        failure = { code: "NO_BENEFICIARIES", message: "the batch has no payments to put in a bank file" };
      } else if (digestFor(claimed, beneficiaries).digest !== claimed.batchDigest) {
        failure = { code: "BATCH_CHANGED_AFTER_SIGNING", message: "the batch contents changed after the signature was verified; nothing was sent" };
      } else {
        const date = new Date().toISOString().slice(0, 10);
        const rows: BankFileRow[] = beneficiaries.map((b) => ({
          ifsc: b.ifsc, accountNo: b.account, accountName: b.beneficiary || "Unknown beneficiary", amountMinor: b.amountMinor,
          narration: `${claimed.type}/${claimed.pfmsId}`.slice(0, 25), paymentDate: date,
        }));
        // Deterministic remote name: a re-release after an ambiguous acknowledgement overwrites the same file.
        const path = await sendNachFile({ pfmsBatchId: claimed.id, agencyCode: claimed.agencyCode ?? "", rows, fileName: releaseFileName(claimed.id) });
        // No SFTP configured = nothing was sent. Only a sandbox deployment treats that as sent.
        if (path === null && isProductionDeployment()) failure = { code: "SFTP_NOT_CONFIGURED", message: "the PFMS SFTP gateway is not configured; nothing was sent" };
      }
    } catch (err) {
      log.error({ err, id: p.id }, "PFMS release upload failed");
      failure = { code: "SEND_FAILED", message: "the file could not be delivered to the PFMS gateway" };
    }

    await db.transaction(async (tx) => {
      const row = await repo.finishPfmsRelease(tx, p.id, p.tenantId, msg.actorId, failure ? { status: "signed", failureCode: failure.code } : { status: "file_sent" });
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
      await audit(tx, msg, "release", p.id, "success", { beneficiaryCount, mock: row.dscMock, certificateSerial: row.dscCertSerial, fileName: releaseFileName(p.id) });
    });
    await cache.invalidateResource(msg.tenantId, "pfms");
  });

  // ── operator resolves an ambiguous release (send_unknown) ─────────────────
  queue.subscribe(COMMANDS.pfmsReleaseResolve, async (rawMsg) => {
    const msg = rawMsg as unknown as Msg;
    const p = msg.payload as { id: string; tenantId: string; outcome: "sent" | "not_sent"; reason: string };
    const target = p.outcome === "sent" ? "file_sent" : "signed";
    const batch = await repo.findPfmsById(p.id, p.tenantId);
    if (!batch) { await refuse(msg, p.id, "release_resolve", "NOT_FOUND", `PFMS batch ${p.id} not found`, "failure"); return; }
    if (batch.submissionStatus !== "send_unknown") {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await audit(tx, msg, "release_resolve_skipped", p.id, "success", { reason: `batch is ${batch.submissionStatus}, not send_unknown` });
      });
      return;
    }
    const settings = await db.transaction((tx) => loadSettingsTx(tx, p.tenantId));
    const distinct = checkDistinct(settings.makerCheckerEnabled, batch.releasedBy, msg.actorId, "the user who started this release cannot also resolve it");
    if (!distinct.ok) { await refuse(msg, p.id, "release_resolve", distinct.code, distinct.message); return; }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.resolvePfmsRelease(tx, p.id, p.tenantId, msg.actorId, target);
      if (!row) { await audit(tx, msg, "release_resolve_skipped", p.id, "success", { reason: "lost the race; the batch is no longer send_unknown" }); return; }
      if (target === "file_sent") {
        await enqueue(tx, {
          topic: "finance.pfms.batch_released", eventType: "finance.pfms.batch_released",
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { batchId: p.id, resolvedByOperator: true },
        });
      }
      await audit(tx, msg, "release_resolve", p.id, "success", { outcome: p.outcome, to: target, reason: p.reason, releasedBy: batch.releasedBy });
    });
    await cache.invalidateResource(msg.tenantId, "pfms");
  });

  // ── void a signature so a changed batch can be signed again ───────────────
  queue.subscribe(COMMANDS.pfmsSignatureVoid, async (rawMsg) => {
    const msg = rawMsg as unknown as Msg;
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    const batch = await repo.findPfmsById(p.id, p.tenantId);
    if (!batch) { await refuse(msg, p.id, "signature_void", "NOT_FOUND", `PFMS batch ${p.id} not found`, "failure"); return; }
    if (batch.submissionStatus !== "signed") {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await audit(tx, msg, "signature_void_skipped", p.id, "success", { reason: `batch is ${batch.submissionStatus}, not signed` });
      });
      return;
    }
    const settings = await db.transaction((tx) => loadSettingsTx(tx, p.tenantId));
    const distinct = checkDistinct(settings.makerCheckerEnabled, batch.signedBy, msg.actorId, "the user who signed this batch cannot also void its signature");
    if (!distinct.ok) { await refuse(msg, p.id, "signature_void", distinct.code, distinct.message); return; }
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.voidPfmsSignature(tx, p.id, p.tenantId, msg.actorId);
      if (!row) { await audit(tx, msg, "signature_void_skipped", p.id, "success", { reason: "lost the race; the batch is no longer signed" }); return; }
      await audit(tx, msg, "signature_void", p.id, "success", {
        reason: p.reason, voidedCertificateSerial: batch.dscCertSerial, voidedBatchDigest: batch.batchDigest, voidedMock: batch.dscMock, signedBy: batch.signedBy,
      });
    });
    await cache.invalidateResource(msg.tenantId, "pfms");
  });
}

// ── stuck-release sweeper ───────────────────────────────────────────────────

export const STUCK_RELEASE_MINUTES_DEFAULT = 30;
const stuckMinutes = (): number => {
  const n = Number(process.env.PFMS_RELEASE_STUCK_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : STUCK_RELEASE_MINUTES_DEFAULT;
};

type StuckRef = { id: string; tenantId: string };

/** Cross-tenant READ of releases claimed before the cutoff and never finished (finance_scanner role; migration 0092 grants SELECT). */
async function findStuckViaScanner(cutoff: Date): Promise<StuckRef[]> {
  const { scannerSqlClient } = await import("../../shared/scanner-db.js");
  const rows = await scannerSqlClient<{ id: string; tenant_id: string }[]>`
    SELECT id, tenant_id FROM payments.finance_pfms
    WHERE submission_status = 'processing' AND channel = 'treasury_batch' AND release_started_at IS NOT NULL AND release_started_at < ${cutoff}
    ORDER BY release_started_at ASC LIMIT 200`;
  return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id }));
}

/**
 * H1: a release whose worker died between the claim and the final write leaves the batch in `processing`; the file may
 * or may not have reached the gateway. After N minutes (PFMS_RELEASE_STUCK_MINUTES, default 30) the batch is moved to the
 * operator-visible `send_unknown` state with a HIGH-severity audit and an alert event. NEVER auto-resends: a finance
 * admin must confirm sent / not sent (release_resolve). Returns how many batches were moved.
 */
export async function sweepStuckReleases(
  opts: { olderThanMinutes?: number; now?: Date; findStuck?: (cutoff: Date) => Promise<StuckRef[]> } = {},
): Promise<number> {
  const minutes = opts.olderThanMinutes ?? stuckMinutes();
  const cutoff = new Date((opts.now ?? new Date()).getTime() - minutes * 60_000);
  const stuck = await (opts.findStuck ?? findStuckViaScanner)(cutoff);
  let moved = 0;
  for (const ref of stuck) {
    await runWithTenant(ref.tenantId, () => db.transaction(async (tx) => {
      const row = await repo.markPfmsSendUnknown(tx, ref.id, ref.tenantId, cutoff);
      if (!row) return;
      moved++;
      const correlationId = randomUUID();
      const details = { severity: "high", code: "RELEASE_OUTCOME_UNKNOWN", pfmsId: row.pfmsId, releasedBy: row.releasedBy, stuckMinutes: minutes,
        message: "a release did not finish; the file may or may not have reached the PFMS gateway. Check the gateway, then resolve it." };
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: ref.tenantId, actorId: SYSTEM_ACTOR, correlationId,
        payload: { service: "finance", action: "release_send_unknown", resourceType: "pfms_batch", resourceId: ref.id, outcome: "failure", details },
      });
      // Alert: a domain event for the notification/alerting consumers.
      await enqueue(tx, {
        topic: "finance.pfms.release_send_unknown", eventType: "finance.pfms.release_send_unknown", tenantId: ref.tenantId, actorId: SYSTEM_ACTOR, correlationId,
        payload: { batchId: ref.id, pfmsId: row.pfmsId, severity: "high" },
      });
      log.error({ id: ref.id, tenantId: ref.tenantId, pfmsId: row.pfmsId }, "PFMS release stuck in processing: moved to send_unknown, operator action required");
    }));
  }
  return moved;
}
