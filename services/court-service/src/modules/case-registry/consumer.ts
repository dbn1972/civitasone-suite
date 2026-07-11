import type { CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { deriveInitialStatus, validateCnr } from "./domain.js";

type RegisterCasePayload = {
  id: string;
  tenantId: string;
  cnrNumber: string;
  caseType: string;
  filingNumber?: string;
  filingDate: string;
  title: string;
  courtId: string;
  benchId?: string;
  parties: Array<{
    partyRole: string;
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    advocateName?: string;
    advocateBarId?: string;
  }>;
};

export function registerCaseRegistryConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  register<RegisterCasePayload>(COMMANDS.registerCase, async (msg) => {
    const p = msg.payload;
    const cnrNumber = validateCnr(p.cnrNumber);
    const initialStatus = deriveInitialStatus();

    await db.transaction(async (tx) => {
      // Idempotency: a redelivery (same messageId) is a hard no-op.
      if (!(await markProcessed(tx, msg.messageId))) return;

      await repo.insertCase(tx, {
        id: p.id,
        tenantId: p.tenantId,
        cnrNumber,
        caseType: p.caseType,
        filingNumber: p.filingNumber ?? null,
        // `filing_date` is a DATE column (string mode) — pass YYYY-MM-DD.
        filingDate: p.filingDate.slice(0, 10),
        title: p.title,
        status: initialStatus,
        stage: initialStatus,
        courtId: p.courtId,
        benchId: p.benchId ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // PII party contact fields land in the encryptedText columns as-is; the
      // column type performs envelope encryption transparently on write.
      await repo.insertParties(tx, p.parties.map((party) => ({
        tenantId: p.tenantId,
        caseId: p.id,
        partyRole: party.partyRole,
        nameEnc: party.name,
        addressEnc: party.address ?? null,
        phoneEnc: party.phone ?? null,
        emailEnc: party.email ?? null,
        advocateName: party.advocateName ?? null,
        advocateBarId: party.advocateBarId ?? null,
      })));

      // Append-only audit of the lifecycle entry point (null → filed).
      await repo.insertStateTransition(tx, {
        tenantId: p.tenantId,
        caseId: p.id,
        fromStatus: null,
        toStatus: initialStatus,
        actorId: msg.actorId,
        reason: "case_registered",
        occurredAt: new Date(),
      });

      await enqueue(tx, {
        topic: EVENTS.caseRegistered,
        eventType: EVENTS.caseRegistered,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { caseId: p.id, cnrNumber, courtId: p.courtId, status: initialStatus },
      });

      await audit(tx, msg, "register", "court_case", p.id);
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
