import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { caseParties } from "./schema.js";
import * as repo from "./repo.js";

type AddPartyPayload = {
  id: string;
  caseId: string;
  tenantId: string;
  partyRole: string;
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  advocateName?: string;
  advocateBarId?: string;
};

type UpdateAdvocatePayload = {
  partyId: string;
  tenantId: string;
  advocateName?: string;
  advocateBarId?: string;
  expectedVersion: number;
};

export function registerPartyConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Add a party / advocate (§14/§15). Cleartext PII is written through the
  // encryptedText columns (encrypted at rest); the emitted event carries NO PII.
  register<AddPartyPayload>(COMMANDS.addParty, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertParty(tx, {
        id: p.id,
        tenantId: p.tenantId,
        caseId: p.caseId,
        partyRole: p.partyRole,
        nameEnc: p.name ?? null,
        addressEnc: p.address ?? null,
        phoneEnc: p.phone ?? null,
        emailEnc: p.email ?? null,
        advocateName: p.advocateName ?? null,
        advocateBarId: p.advocateBarId ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      // Event payload MUST NOT contain raw PII — only ids/role.
      await enqueue(tx, {
        topic: EVENTS.partyAdded,
        eventType: EVENTS.partyAdded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { partyId: p.id, caseId: p.caseId, partyRole: p.partyRole },
      });
      await audit(tx, msg, "add_party", "court_party", p.id);
    });
  });

  // Update an advocate's details (§15) — version-guarded.
  register<UpdateAdvocatePayload>(COMMANDS.updateAdvocate, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const current = await repo.getPartyForUpdate(tx, p.tenantId, p.partyId);
      if (!current) throw new NonRetryableError(`PARTY_NOT_FOUND: ${p.partyId}`);

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: party ${p.partyId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }

      await versionedUpdate(tx, caseParties, {
        id: p.partyId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          ...(p.advocateName !== undefined ? { advocateName: p.advocateName } : {}),
          ...(p.advocateBarId !== undefined ? { advocateBarId: p.advocateBarId } : {}),
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "party",
      });

      await enqueue(tx, {
        topic: EVENTS.advocateUpdated,
        eventType: EVENTS.advocateUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { partyId: p.partyId },
      });
      await audit(tx, msg, "update_advocate", "court_party", p.partyId);
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
  // Audit payload carries ids/role only — NEVER decrypted PII.
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
