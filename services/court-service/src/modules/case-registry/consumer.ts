import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as configRepo from "../config-registry/repo.js";
import { deriveInitialStatus, validateCnr, DEFAULT_CASE_TYPES, assertCaseTypeAllowed, DEFAULT_DISPOSAL_DAYS, resolveDisposalDays, addDays } from "./domain.js";
import { effectiveAllowed } from "../config-registry/domain.js";

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

      // §47 config/metadata: caseType must be in the effective allowed set — the
      // tenant’s configured `case_type` values when any exist (AUTHORITATIVE —
      // REPLACES the defaults), else DEFAULT_CASE_TYPES.
      const configured = await configRepo.listActiveKeys(tx, p.tenantId, "case_type");
      const allowedTypes = effectiveAllowed(configured, DEFAULT_CASE_TYPES);
      try {
        assertCaseTypeAllowed(p.caseType, allowedTypes);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      // §47 sla_timer: derive the target disposal date from tenant config
      // (disposal days by case type; default when unconfigured) + filing date.
      const slaCfg = await configRepo.getConfigValueOnTx(tx, p.tenantId, "sla_timer", p.caseType);
      const targetDisposalDate = addDays(p.filingDate, resolveDisposalDays(slaCfg, DEFAULT_DISPOSAL_DAYS));
      await repo.insertCase(tx, {
        id: p.id,
        tenantId: p.tenantId,
        cnrNumber,
        caseType: p.caseType,
        filingNumber: p.filingNumber ?? null,
        // `filing_date` is a DATE column (string mode) — pass YYYY-MM-DD.
        filingDate: p.filingDate.slice(0, 10),
        targetDisposalDate,
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
