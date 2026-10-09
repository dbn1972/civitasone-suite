/**
 * Citizen-lease consumer — municipal property leasing (BRD 5.26 ESTATE-001…004).
 *
 * GAP2-ESTAB-BOOKING-ORPHAN-01 (sibling): the citizen-lease routes shipped but
 * had no consumer, so every command was published to a topic nobody consumed.
 * This consumer applies the CQRS writes (command → DB + outbox audit), is
 * idempotent (markProcessed), and audits every mutation in the same tx.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import {
  assertRequestTransition, generateLeaseNumber, generateRequestNumber, DomainError,
} from "./domain.js";
import { estabLeaseProperties, estabLeases, estabLeasePayments, estabLeaseRequests } from "./schema.js";

const log = pino({ name: "citizen-lease-consumer" });
const AUDIT_TOPIC = "audit.event.record";

type Msg = {
  messageId: string; tenantId: string; actorId: string; correlationId: string;
  payload: Record<string, unknown>;
};

export function registerCitizenLeaseConsumers(queue: Queue): void {
  // ── Create property ────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.leasePropertyCreate, async (msg: Msg) => {
    try {
      const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(estabLeaseProperties).values({
          id: p.id, tenantId: p.tenantId,
          propertyCode: String(p.propertyCode), propertyType: String(p.propertyType),
          location: (p.location as object | undefined) ?? null,
          area: (p.area as string | undefined) ?? null,
          areaUnit: (p.areaUnit as string | undefined) ?? "sqft",
          monthlyRentMinor: BigInt(String(p.monthlyRentMinor)),
          leaseTermMonths: (p.leaseTermMonths as number | undefined) ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "lease_property_created", "lease_property", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "leasePropertyCreate failed"); }
  });

  // ── Create lease ───────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.leaseCreate, async (msg: Msg) => {
    try {
      const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string; propertyId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(estabLeases).values({
          id: p.id, tenantId: p.tenantId, leaseNumber: generateLeaseNumber(),
          propertyId: p.propertyId, tenantName: String(p.tenantName),
          tenantPhone: String(p.tenantPhone ?? ""),
          tenantAadhaar: (p.tenantAadhaar as string | undefined) ?? null,
          tenantAddress: (p.tenantAddress as object | undefined) ?? null,
          leaseStartDate: String(p.leaseStartDate), leaseEndDate: String(p.leaseEndDate),
          monthlyRentMinor: BigInt(String(p.monthlyRentMinor)),
          securityDepositMinor: p.securityDepositMinor != null ? BigInt(String(p.securityDepositMinor)) : null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        // Mark the property leased.
        await tx.update(estabLeaseProperties).set({ status: "leased", updatedBy: msg.actorId, updatedAt: new Date() })
          .where(and(eq(estabLeaseProperties.id, p.propertyId), eq(estabLeaseProperties.tenantId, p.tenantId)));
        await audit(tx, msg, "lease_created", "lease", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "leaseCreate failed"); }
  });

  // ── Record a lease payment ─────────────────────────────────────────────
  queue.subscribe(COMMANDS.leasePaymentRecord, async (msg: Msg) => {
    try {
      const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string; leaseId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(estabLeasePayments).values({
          id: p.id, tenantId: p.tenantId, leaseId: p.leaseId,
          paymentMonth: String(p.paymentMonth), amountMinor: BigInt(String(p.amountMinor)),
          dueDate: String(p.dueDate),
          paymentRef: (p.paymentRef as string | undefined) ?? null,
          paidAt: p.paymentRef ? new Date() : null,
          status: p.paymentRef ? "paid" : "pending",
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "lease_payment_recorded", "lease_payment", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "leasePaymentRecord failed"); }
  });

  // ── Submit a lease request ─────────────────────────────────────────────
  queue.subscribe(COMMANDS.leaseRequestSubmit, async (msg: Msg) => {
    try {
      const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string; leaseId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(estabLeaseRequests).values({
          id: p.id, tenantId: p.tenantId, leaseId: p.leaseId,
          requestType: String(p.requestType), requestNumber: generateRequestNumber(),
          requestedBy: msg.actorId, status: "submitted",
          transfereeName: (p.transfereeName as string | undefined) ?? null,
          transfereePhone: (p.transfereePhone as string | undefined) ?? null,
          transfereeAadhaar: (p.transfereeAadhaar as string | undefined) ?? null,
          surrenderDate: (p.surrenderDate as string | undefined) ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "lease_request_submitted", "lease_request", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "leaseRequestSubmit failed"); }
  });

  // ── Review a lease request (approve / reject) ──────────────────────────
  queue.subscribe(COMMANDS.leaseRequestReview, async (msg: Msg) => {
    try {
      const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string; decision: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabLeaseRequests)
          .where(and(eq(estabLeaseRequests.id, p.id), eq(estabLeaseRequests.tenantId, p.tenantId))).limit(1);
        const request = rows[0];
        if (!request) throw new DomainError("REQUEST_NOT_FOUND", "lease request not found");
        const target = p.decision === "approved" ? "approved" : "rejected";
        // submitted → under_review → approved/rejected: fold the intermediate
        // step so a single review action is a legal transition.
        if (request.status === "submitted") assertRequestTransition("submitted", "under_review");
        assertRequestTransition(request.status === "submitted" ? "under_review" : request.status, target);
        await tx.update(estabLeaseRequests).set({
          status: target, approvedBy: msg.actorId, approvedAt: new Date(),
          remarks: (p.remarks as string | undefined) ?? null,
          updatedBy: msg.actorId, updatedAt: new Date(),
          version: sql`${estabLeaseRequests.version} + 1`,
        }).where(and(eq(estabLeaseRequests.id, p.id), eq(estabLeaseRequests.tenantId, p.tenantId)));
        await audit(tx, msg, `lease_request_${target}`, "lease_request", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "leaseRequestReview failed"); }
  });

  // ── Complete a lease request ───────────────────────────────────────────
  queue.subscribe(COMMANDS.leaseRequestComplete, async (msg: Msg) => {
    try {
      const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabLeaseRequests)
          .where(and(eq(estabLeaseRequests.id, p.id), eq(estabLeaseRequests.tenantId, p.tenantId))).limit(1);
        const request = rows[0];
        if (!request) throw new DomainError("REQUEST_NOT_FOUND", "lease request not found");
        assertRequestTransition(request.status, "completed");
        await tx.update(estabLeaseRequests).set({
          status: "completed",
          noDuesCertificateRef: (p.noDuesCertificateRef as string | undefined) ?? null,
          updatedBy: msg.actorId, updatedAt: new Date(),
          version: sql`${estabLeaseRequests.version} + 1`,
        }).where(and(eq(estabLeaseRequests.id, p.id), eq(estabLeaseRequests.tenantId, p.tenantId)));
        await audit(tx, msg, "lease_request_completed", "lease_request", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "leaseRequestComplete failed"); }
  });
}

async function audit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  msg: Msg, action: string, resourceType: string, resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}
