import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { maskAadhaar } from "./domain.js";

export function registerBeneficiaryConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.beneficiaryCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; type: string;
      category?: string; age?: number; incomeAnnualMinor: number; currency?: string; geography?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertBeneficiary(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, type: p.type,
        category: p.category ?? null, age: p.age ?? null,
        incomeAnnualMinor: BigInt(p.incomeAnnualMinor),
        currency: p.currency ?? "INR",
        geography: p.geography ?? null,
        status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.beneficiaryCreated, eventType: EVENTS.beneficiaryCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { beneficiaryId: p.id },
      });
      await audit(tx, msg, "create", "grant_beneficiary", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "beneficiary", p.id));
  });

  queue.subscribe(COMMANDS.beneficiaryLinkBank, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; beneficiaryId: string;
      accountNoMasked: string; bankIfsc: string; bankName?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertBankAccount(tx, {
        id: p.id, tenantId: p.tenantId, beneficiaryId: p.beneficiaryId,
        accountNoMasked: p.accountNoMasked, bankIfsc: p.bankIfsc,
        bankName: p.bankName ?? null, npciLinked: false, status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "link_bank", "grant_beneficiary", p.beneficiaryId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "beneficiary", p.beneficiaryId));
  });

  queue.subscribe(COMMANDS.beneficiarySeedAadhaar, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; beneficiaryId: string;
      aadhaar: string; bankAccountId?: string;
    };
    // DPDP §4: extract last4 + token immediately, raw Aadhaar never reaches DB
    const { last4, token } = maskAadhaar(p.aadhaar);

    // De-duplication: reject if this Aadhaar token already belongs to a different beneficiary
    const existing = await repo.findAadhaarByTokenAndTenant(p.tenantId, token);
    if (existing && existing.beneficiaryId !== p.beneficiaryId) {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await enqueue(tx, {
          topic: EVENTS.beneficiaryCreated, eventType: "grant.beneficiary.aadhaar_duplicate",
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            beneficiaryId: p.beneficiaryId,
            aadhaarLast4: last4,
            existingBeneficiaryId: existing.beneficiaryId,
            reason: "AADHAAR_DUPLICATE: this Aadhaar is already registered to another beneficiary in this tenant",
          },
        });
        await audit(tx, msg, "aadhaar_duplicate_rejected", "grant_beneficiary", p.beneficiaryId);
      });
      return;
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAadhaarLink(tx, {
        id: p.id, tenantId: p.tenantId, beneficiaryId: p.beneficiaryId,
        aadhaarLast4: last4, aadhaarToken: token,
        npciBankRef: p.bankAccountId ? `grant_bank_accounts:${p.bankAccountId}` : null,
        status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "seed_aadhaar", "grant_beneficiary", p.beneficiaryId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "beneficiary", p.beneficiaryId));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "grant", action, resourceType, resourceId, outcome: "success" },
  });
}
