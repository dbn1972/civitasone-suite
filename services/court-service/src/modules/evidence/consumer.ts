import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { evidence } from "./schema.js";
import * as repo from "./repo.js";
import { assertTransition, type EvidenceStatus } from "./domain.js";

type SubmitEvidencePayload = {
  id: string;
  caseId: string;
  tenantId: string;
  filingId?: string;
  exhibitNumber?: string;
  title: string;
  evidenceType?: EvidenceStatus | string;
  storageRef?: string;
  contentHash?: string;
};

type RuleEvidencePayload = {
  evidenceId: string;
  tenantId: string;
  ruling: EvidenceStatus;
  rulingRemarks?: string;
  expectedVersion: number;
};

export function registerEvidenceConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Submit a piece of evidence/exhibit (§22).
  register<SubmitEvidencePayload>(COMMANDS.submitEvidence, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertEvidence(tx, {
        id: p.id,
        tenantId: p.tenantId,
        caseId: p.caseId,
        filingId: p.filingId ?? null,
        exhibitNumber: p.exhibitNumber ?? null,
        title: p.title,
        evidenceType: p.evidenceType ?? "document",
        storageRef: p.storageRef ?? null,
        contentHash: p.contentHash ?? null,
        status: "submitted",
        submittedBy: msg.actorId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.evidenceSubmitted,
        eventType: EVENTS.evidenceSubmitted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          caseId: p.caseId,
          evidenceId: p.id,
          evidenceType: p.evidenceType ?? "document",
          exhibitNumber: p.exhibitNumber ?? null,
        },
      });
      await audit(tx, msg, "submit", "court_evidence", p.id);
    });
  });

  // Rule on an exhibit (§22) — version-guarded, state-machine-checked.
  register<RuleEvidencePayload>(COMMANDS.ruleOnEvidence, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const current = await repo.getEvidenceForUpdate(tx, p.tenantId, p.evidenceId);
      if (!current) throw new NonRetryableError(`EVIDENCE_NOT_FOUND: ${p.evidenceId}`);
      if (current.status === p.ruling) return; // already at target ruling; no-op

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: evidence ${p.evidenceId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }
      try {
        assertTransition(current.status, p.ruling);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      await versionedUpdate(tx, evidence, {
        id: p.evidenceId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          status: p.ruling,
          ...(p.rulingRemarks !== undefined ? { rulingRemarks: p.rulingRemarks } : {}),
          ruledBy: msg.actorId,
          ruledAt: new Date(),
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "evidence",
      });

      await enqueue(tx, {
        topic: EVENTS.evidenceRuled,
        eventType: EVENTS.evidenceRuled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          evidenceId: p.evidenceId,
          ruling: p.ruling,
          rulingRemarks: p.rulingRemarks ?? null,
        },
      });
      await audit(tx, msg, "rule", "court_evidence", p.evidenceId);
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
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
