import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { certifiedCopies } from "./schema.js";
import * as repo from "./repo.js";
import * as configRepo from "../config-registry/repo.js";
import { assertTransition, computeCopyFeeMinor, type CopyStatus } from "./domain.js";

type RequestCopyPayload = {
  id: string;
  caseId: string;
  tenantId: string;
  orderId?: string;
  documentRef?: string;
  applicantName?: string; // PII — cleartext in payload only, encrypted at rest
  copiesCount: number;
  urgent?: boolean;
  feeMinorHint?: string | number; // client hint only; server config wins
};

type TransitionCopyPayload = {
  copyId: string;
  tenantId: string;
  target: CopyStatus;
  deliveryMode?: string;
  remarks?: string;
  expectedVersion: number;
};

/** Default per-copy fee (paise) when neither config nor a valid client hint applies. */
const DEFAULT_PER_COPY_MINOR = 500n;

/**
 * Parse a config-schedule fee value to non-negative integer PAISE (BigInt). A
 * malformed value is a poison message (the caller wraps this in a NonRetryableError
 * INVALID_COPY_FEE_SCHEDULE). Accepts a JSON number or a numeric string.
 */
function parseFeePaise(value: unknown): bigint {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new Error(
    `INVALID_COPY_FEE_SCHEDULE: copy_fee value must be a non-negative integer paise amount, got ${JSON.stringify(value)}`,
  );
}

/** Best-effort parse of a CLIENT-supplied fee hint; undefined when not a clean amount. */
function parseHintPaise(value: string | number | undefined): bigint | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  return undefined;
}

export function registerCertifiedCopyConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Apply for a certified copy (§30) — resolves the SERVER-AUTHORITATIVE fee.
  register<RequestCopyPayload>(COMMANDS.requestCertifiedCopy, async (msg) => {
    const p = msg.payload;
    const urgent = p.urgent ?? false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // exactly-once

      // §30/§47 copy_fee: the SERVER-configured per-copy fee is authoritative
      // (a client cannot lower/tamper it); a malformed schedule value is a poison
      // message. With no schedule configured, fall back to the client hint or a
      // documented default. An OPTIONAL flat urgent surcharge is read separately.
      const perCopyKey = urgent ? "urgent" : "standard";
      const perCopyCfg = await configRepo.getConfigValueOnTx(tx, p.tenantId, "copy_fee", perCopyKey);

      let perCopyMinor: bigint;
      let feeSource: "config" | "client";
      let surchargeMinor = 0n;
      try {
        if (perCopyCfg !== undefined && perCopyCfg !== null) {
          perCopyMinor = parseFeePaise(perCopyCfg);
          feeSource = "config";
          // Optional flat urgent surcharge — only applied when urgent.
          if (urgent) {
            const surchargeCfg = await configRepo.getConfigValueOnTx(tx, p.tenantId, "copy_fee", "urgent_surcharge");
            if (surchargeCfg !== undefined && surchargeCfg !== null) {
              surchargeMinor = parseFeePaise(surchargeCfg);
            }
          }
        } else {
          perCopyMinor = parseHintPaise(p.feeMinorHint) ?? DEFAULT_PER_COPY_MINOR;
          feeSource = "client";
        }
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      const feeMinor = computeCopyFeeMinor(perCopyMinor, p.copiesCount, urgent, surchargeMinor);

      await repo.insertCopy(tx, {
        id: p.id,
        tenantId: p.tenantId,
        caseId: p.caseId,
        orderId: p.orderId ?? null,
        documentRef: p.documentRef ?? null,
        // PII: cleartext written through the encryptedText column (AES at rest).
        applicantNameEnc: p.applicantName ?? null,
        copiesCount: p.copiesCount,
        urgent,
        feeMinor,
        feeSource,
        status: "requested",
        requestedBy: msg.actorId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Event payload MUST NOT contain the raw applicant name (PII). feeMinor is a
      // STRING because BigInt is not JSON-serialisable.
      await enqueue(tx, {
        topic: EVENTS.certifiedCopyRequested,
        eventType: EVENTS.certifiedCopyRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          copyId: p.id,
          caseId: p.caseId,
          status: "requested",
          feeMinor: feeMinor.toString(),
          feeSource,
        },
      });
      await audit(tx, msg, "request", "court_certified_copy", p.id);
    });
  });

  // Transition a certified copy (§30) — version-guarded, state-machine-checked.
  register<TransitionCopyPayload>(COMMANDS.transitionCertifiedCopy, async (msg) => {
    const p = msg.payload;
    const target = p.target;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // exactly-once

      const current = await repo.getCopyForUpdate(tx, p.tenantId, p.copyId);
      if (!current) throw new NonRetryableError(`COPY_NOT_FOUND: ${p.copyId}`);

      // Already at target → transition is done; no-op (redelivery-safe).
      if (current.status === target) return;

      // Stale optimistic-lock token → a concurrent update happened; do not retry.
      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: certified copy ${p.copyId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }

      // Illegal edge per the state machine → do not retry.
      try {
        assertTransition(current.status, target);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      const issuedFields = target === "issued"
        ? {
            issuedBy: msg.actorId,
            issuedAt: new Date(),
            ...(p.deliveryMode !== undefined ? { deliveryMode: p.deliveryMode } : {}),
          }
        : {};

      await versionedUpdate(tx, certifiedCopies, {
        id: p.copyId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          status: target,
          ...issuedFields,
          ...(p.remarks !== undefined ? { remarks: p.remarks } : {}),
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "certified_copy",
      });

      await enqueue(tx, {
        topic: EVENTS.certifiedCopyTransitioned,
        eventType: EVENTS.certifiedCopyTransitioned,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { copyId: p.copyId, from: current.status, to: target },
      });
      await audit(tx, msg, "status_change", "court_certified_copy", p.copyId);
    });
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  // Audit payload carries ids only — NEVER the decrypted applicant name (PII).
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
