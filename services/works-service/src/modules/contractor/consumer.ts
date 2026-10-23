import { pino } from "pino";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { workProposals } from "../proposal/schema.js";
import { ratingCooldownDays, isWithinRatingCooldown } from "./rating-policy.js";
import { eq, and } from "drizzle-orm";

const log = pino({ name: "works-contractor-consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerContractorConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  // works.contractor.create → works.contractors
  queue.subscribe(COMMANDS.contractorCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; name: string;
        registrationNo?: string; classId?: string;
        pan?: string; gst?: string; email?: string; phone?: string; address?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // GAP-WORKS-CONTRACTORS-NEW-05: re-assert registration-number uniqueness in the writing transaction (two
        // concurrent creates can both pass the route check).
        if (p.registrationNo && (await repo.findContractorByRegistrationNoTx(tx, msg.tenantId, p.registrationNo))) {
          throw new NonRetryableError("DUPLICATE_REGISTRATION_NO: a contractor with this registration number already exists");
        }
        await repo.insertContractor(tx, {
          id: p.id, tenantId: msg.tenantId, name: p.name,
          registrationNo: p.registrationNo ?? null,
          classId: p.classId ?? null,
          pan: p.pan ?? null, gst: p.gst ?? null,
          email: p.email ?? null, phone: p.phone ?? null,
          address: p.address ?? null,
          active: true,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "works", action: "create", resourceType: "contractor", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "contractorCreate processing failed");
      // A rejected duplicate must be dead-lettered (observable), not silently swallowed like a transient failure.
      if (err instanceof NonRetryableError) throw err;
    }
  });

  // works.contractor.update → apply basic-info patch + audit (GAP2-WORKS-
  // CONTRACTORS-03). The PATCH edit path now routes through this consumer
  // (CQRS) instead of writing to Postgres inside the route handler with no
  // audit event. The before/after of changed fields is recorded in the audit
  // event WITHOUT the clear PAN value (DPDP): the pan field is reported only
  // as "changed", never its decrypted value.
  queue.subscribe(COMMANDS.contractorUpdate, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; patch: Record<string, unknown> };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const newRegNo = typeof p.patch.registrationNo === "string" ? p.patch.registrationNo : "";
        if (newRegNo && (await repo.findContractorByRegistrationNoTx(tx, msg.tenantId, newRegNo, p.id))) {
          throw new NonRetryableError("DUPLICATE_REGISTRATION_NO: a contractor with this registration number already exists");
        }
        const applied = await repo.applyContractorUpdate(tx, msg.tenantId, p.id, p.patch, msg.actorId);
        if (!applied) throw new NonRetryableError("CONTRACTOR_NOT_FOUND: contractor not found for update");
        // Record WHICH fields changed, never PII values (pan is reported as a
        // changed field name only — the clear value is never logged).
        const changedFields = Object.keys(p.patch);
        await enqueue(tx, {
          topic: EVENTS.contractorUpdated, eventType: EVENTS.contractorUpdated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, fields: changedFields },
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "works", action: "update", resourceType: "contractor", resourceId: p.id, outcome: "success", fields: changedFields },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "contractorUpdate processing failed");
      throw err;
    }
  });

  // works.contractor.rate → incremental average update + rating history
  queue.subscribe(COMMANDS.contractorRate, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; rating: number; comment?: string; workId?: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // GAP-WORKS-CONTRACTORS-DETAIL-04: lock the contractor row BEFORE reading the rating history. Two rate commands
        // from one officer (each with its own messageId) are then serialised: the second one waits for the first to
        // commit and its cooling-off check below sees the first one's rating, instead of both reading an empty
        // history, both passing and both inserting.
        if (!(await repo.lockContractorTx(tx, msg.tenantId, p.id))) {
          throw new NonRetryableError("CONTRACTOR_NOT_FOUND: contractor not found for rating");
        }
        // The cooling-off period is re-asserted in the writing transaction (two quick submits can both pass the route
        // check). Skipped entirely while no cooldown is configured.
        const cooldownDays = ratingCooldownDays();
        if (cooldownDays > 0) {
          const last = await repo.latestRatingByActorTx(tx, msg.tenantId, p.id, msg.actorId);
          if (last && isWithinRatingCooldown(last.ratedAt, new Date(), cooldownDays)) {
            throw new NonRetryableError("RATING_COOLDOWN: this officer already rated the contractor within the cooling-off period");
          }
        }
        // The work a rating is linked to must exist in this tenant (the route checks too; this is the authoritative one).
        if (p.workId) {
          const work = await tx.select({ id: workProposals.id }).from(workProposals)
            .where(and(eq(workProposals.tenantId, msg.tenantId), eq(workProposals.id, p.workId)))
            .limit(1);
          if (work.length === 0) throw new NonRetryableError("WORK_NOT_FOUND: the work cited for this rating does not exist");
        }
        await repo.updateContractorRating(tx, p.id, msg.tenantId, p.rating);
        await repo.insertRatingHistory(tx, {
          tenantId: msg.tenantId,
          contractorId: p.id,
          rating: p.rating,
          ratedBy: msg.actorId,
          note: p.comment ?? null,
          workId: p.workId ?? null,
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          // The stated basis for the rating is part of the audit trail (a rating affects tender eligibility). It is a
          // free-text performance note, not PII, and travels the same way the PAN-reveal reason does.
          payload: { service: "works", action: "rate", resourceType: "contractor", resourceId: p.id, outcome: "success", rating: p.rating, reason: p.comment ?? null, workId: p.workId ?? null },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "contractorRate processing failed");
      // A refused (cooldown) rating is dead-lettered, observable, not swallowed like a transient failure.
      if (err instanceof NonRetryableError) throw err;
    }
  });
}
