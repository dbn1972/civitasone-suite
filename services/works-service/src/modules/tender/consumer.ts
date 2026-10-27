import { NonRetryableError, type Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { preTenders, tenders, quotations, awards } from "./schema.js";
import { tenderTypes } from "../masters/schema.js";
import { contractors } from "../contractor/schema.js";
import { isSelfApprovalAward } from "./domain.js";
import { eq, and, sql } from "drizzle-orm";

const AUDIT_TOPIC = "audit.event.record";

export function registerTenderConsumers(q: Queue): void {
  q.subscribe(COMMANDS.preTenderCreate, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      // GAP-WORKS-TENDERS-NEW-06: duplicate reference re-checked in the same
      // transaction as the insert (the route pre-check can race).
      if (p.referenceNumber) {
        const dup = await tx.select({ id: preTenders.id }).from(preTenders)
          .where(and(eq(preTenders.tenantId, msg.tenantId), eq(preTenders.referenceNumber, (p.referenceNumber as string).trim())))
          .limit(1);
        if (dup.length > 0) throw new NonRetryableError("DUPLICATE_REFERENCE: a pre-tender with this reference number already exists");
      }
      // D4c #40: the type is saved by its master record; re-checked here (the route pre-check can race a deactivation).
      let tenderTypeId: string | null = null;
      let tenderType = (p.tenderType as string | undefined) ?? null;
      if (p.tenderTypeId) {
        const typeRows = await tx.select({ id: tenderTypes.id, name: tenderTypes.name }).from(tenderTypes)
          .where(and(eq(tenderTypes.tenantId, msg.tenantId), eq(tenderTypes.id, p.tenderTypeId as string), eq(tenderTypes.active, true)))
          .limit(1);
        if (typeRows.length === 0) throw new NonRetryableError("INVALID_TENDER_TYPE: tender type not found or no longer active");
        tenderTypeId = typeRows[0]!.id;
        // Keep the list/detail views that read the text type populated when only the id was sent.
        tenderType = tenderType ?? typeRows[0]!.name.slice(0, 64);
      }
      await tx.insert(preTenders).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        referenceNumber: (p.referenceNumber as string) ?? null,
        tenderType,
        tenderTypeId,
        tenderCategory: (p.tenderCategory as string) ?? null,
        bidValidity: (p.bidValidity as number) ?? null,
        // GAP-WORKS-TENDERS-NEW-02: persist the opening date when supplied.
        openingDate: p.openingDate ? new Date(p.openingDate as string) : null,
        fees: p.fees ? BigInt(p.fees as string | number) : null,
        status: "draft",
        createdBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.preTenderCreated,
        eventType: EVENTS.preTenderCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "create", resourceType: "pre_tender", resourceId: p.id, outcome: "success" } });
    });
  });

  q.subscribe(COMMANDS.awardCreate, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      const contractorName = p.contractorName as string;
      const contractorId = p.contractorId as string | undefined;

      // Bug #4 (defense-in-depth — also enforced pre-enqueue in
      // tender/routes.ts): an award must reference a real, registered
      // contractor, not just a free-text name. Resolve/validate against
      // works.contractors either way so the award always ends up with a
      // real contractor_id link.
      let resolvedContractorId: string;
      if (contractorId) {
        const rows = await tx.select().from(contractors)
          .where(and(eq(contractors.tenantId, msg.tenantId), eq(contractors.id, contractorId)))
          .limit(1);
        const contractor = rows[0];
        if (!contractor) throw new NonRetryableError("CONTRACTOR_NOT_FOUND: contractor not found for contractorId");
        if (contractor.name.trim().toLowerCase() !== contractorName.trim().toLowerCase()) {
          throw new NonRetryableError("CONTRACTOR_NAME_MISMATCH: contractorName does not match the registered contractor record");
        }
        resolvedContractorId = contractorId;
      } else {
        const rows = await tx.select().from(contractors)
          .where(and(
            eq(contractors.tenantId, msg.tenantId),
            sql`lower(${contractors.name}) = lower(${contractorName.trim()})`,
          ))
          .limit(1);
        if (!rows[0]) throw new NonRetryableError("CONTRACTOR_NOT_FOUND: no registered contractor matches contractorName");
        resolvedContractorId = rows[0].id;
      }

      await tx.insert(awards).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        contractorName,
        contractorId: resolvedContractorId,
        agreementNumber: (p.agreementNumber as string) ?? null,
        workOrderNumber: (p.workOrderNumber as string) ?? null,
        workPeriodDays: (p.workPeriodDays as number) ?? null,
        billMode: (p.billMode as string) ?? null,
        acceptedAmountMinor: BigInt(p.acceptedAmountMinor as string | number),
        status: "draft",
        createdBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.awardCreated,
        eventType: EVENTS.awardCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "create", resourceType: "award", resourceId: p.id, outcome: "success" } });
    });
  });

  // ORPHAN FIX: add a contractor quotation to a tender.
  q.subscribe(COMMANDS.quotationAdd, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      const tenderId = p.tenderId as string;

      // Bug #4 (defense-in-depth — also enforced pre-enqueue in
      // tender/routes.ts): tenderId must reference an existing tender or
      // pre-tender (works.tenders currently has no producer, so pre_tenders
      // is the entity actually populated in practice — see repo.ts).
      const tenderRows = await tx.select({ id: tenders.id }).from(tenders)
        .where(and(eq(tenders.tenantId, msg.tenantId), eq(tenders.id, tenderId)))
        .limit(1);
      if (tenderRows.length === 0) {
        const preTenderRows = await tx.select({ id: preTenders.id }).from(preTenders)
          .where(and(eq(preTenders.tenantId, msg.tenantId), eq(preTenders.id, tenderId)))
          .limit(1);
        if (preTenderRows.length === 0) {
          throw new NonRetryableError("TENDER_NOT_FOUND: tenderId does not reference an existing tender or pre-tender");
        }
      }

      // GAP-WORKS-TENDERS-DETAIL-01 (defense-in-depth): re-validate a supplied
      // contractorId against works.contractors inside the same transaction.
      const quotContractorId = p.contractorId as string | undefined;
      if (quotContractorId) {
        const cRows = await tx.select().from(contractors)
          .where(and(eq(contractors.tenantId, msg.tenantId), eq(contractors.id, quotContractorId)))
          .limit(1);
        if (!cRows[0]) throw new NonRetryableError("CONTRACTOR_NOT_FOUND: contractor not found for contractorId");
        if (cRows[0].name.trim().toLowerCase() !== (p.contractorName as string).trim().toLowerCase()) {
          throw new NonRetryableError("CONTRACTOR_NAME_MISMATCH: contractorName does not match the registered contractor record");
        }
      }

      await tx.insert(quotations).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        tenderId,
        contractorName: p.contractorName as string,
        contractorId: quotContractorId ?? null,
        method: p.method as string,
        quotedAmountMinor: p.quotedAmountMinor !== undefined ? BigInt(p.quotedAmountMinor as string | number) : null,
        quotedPercentage: (p.quotedPercentage as string) ?? null,
        aboveOrBelowOrAtPar: (p.aboveOrBelowOrAtPar as string) ?? null,
      });

      await enqueue(tx, {
        topic: EVENTS.quotationAdded,
        eventType: EVENTS.quotationAdded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, tenderId: p.tenderId },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "process", resourceType: "tender", resourceId: p.id, outcome: "success" } });
    });
  });

  // ORPHAN FIX (SVC-067): DAO-finalize award — level 1 of two-level finalization.
  // Guarded update (status must still be 'draft') enforces the transition even
  // on redelivery / concurrent DO-finalize.
  q.subscribe(COMMANDS.awardDaoFinalize, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const { id } = msg.payload as { id: string };

      // GAP2-WORKS-TENDERS-04: maker-checker enforced HERE (the consumer),
      // inside the transaction, so a directly-published or racing command
      // cannot bypass the route-level pre-check.
      const rows = await tx.select().from(awards)
        .where(and(eq(awards.tenantId, msg.tenantId), eq(awards.id, id)))
        .limit(1);
      const existing = rows[0];
      if (!existing) throw new NonRetryableError("AWARD_NOT_FOUND: award not found for finalize");
      if (isSelfApprovalAward(msg.actorId, { createdBy: existing.createdBy })) {
        throw new NonRetryableError("SELF_APPROVAL_FORBIDDEN: The creator of an award cannot DAO-finalize it (maker-checker rule)");
      }

      await tx.update(awards)
        .set({ status: "dao_finalized", daoFinalizedBy: msg.actorId, daoFinalizedAt: new Date() })
        .where(and(eq(awards.tenantId, msg.tenantId), eq(awards.id, id), eq(awards.status, "draft")));

      await enqueue(tx, {
        topic: EVENTS.awardDaoFinalized,
        eventType: EVENTS.awardDaoFinalized,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "finalize", resourceType: "award_dao", resourceId: id, outcome: "success" } });
    });
  });

  // ORPHAN FIX (SVC-067): DO-finalize award — level 2, requires dao_finalized.
  q.subscribe(COMMANDS.awardDoFinalize, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const { id } = msg.payload as { id: string };

      // GAP2-WORKS-TENDERS-04: maker-checker enforced HERE (the consumer),
      // inside the transaction, so a directly-published or racing command
      // cannot bypass the route-level pre-check.
      const rows = await tx.select().from(awards)
        .where(and(eq(awards.tenantId, msg.tenantId), eq(awards.id, id)))
        .limit(1);
      const existing = rows[0];
      if (!existing) throw new NonRetryableError("AWARD_NOT_FOUND: award not found for finalize");
      if (isSelfApprovalAward(msg.actorId, { createdBy: existing.createdBy }, existing.daoFinalizedBy)) {
        throw new NonRetryableError("SELF_APPROVAL_FORBIDDEN: The DO finalizer must differ from both the award creator and the DAO finalizer (maker-checker rule)");
      }

      await tx.update(awards)
        .set({ status: "do_finalized", doFinalizedBy: msg.actorId, doFinalizedAt: new Date() })
        .where(and(eq(awards.tenantId, msg.tenantId), eq(awards.id, id), eq(awards.status, "dao_finalized")));

      await enqueue(tx, {
        topic: EVENTS.awardDoFinalized,
        eventType: EVENTS.awardDoFinalized,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id },
      });
      await enqueue(tx, {
        topic: EVENTS.awardFinalized,
        eventType: EVENTS.awardFinalized,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id },
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "finalize", resourceType: "award", resourceId: id, outcome: "success" } });
    });
  });
}
