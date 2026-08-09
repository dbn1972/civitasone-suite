/**
 * Citizen-lease consumer — handles property leasing commands (ESTATE-001…004).
 *
 * Commands: createProperty, createLease, recordLeasePayment,
 *           submitLeaseRequest, reviewLeaseRequest, completeLeaseRequest.
 *
 * Idempotency via markProcessed. Audit on every state change.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { assertLeaseTransition, assertRequestTransition, generateLeaseNumber, generateRequestNumber, calculateLateFee } from "./domain.js";
import { eq, and, sql } from "drizzle-orm";
import { estabLeaseProperties, estabLeases, estabLeasePayments, estabLeaseRequests } from "./schema.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const log = pino({ name: "citizen-lease-consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerCitizenLeaseConsumers(rawQueue: Queue): void {
  // ── Create Property ────────────────────────────────────────────────────
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.leasePropertyCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; propertyCode: string; propertyType: string;
        location?: unknown; area?: string; areaUnit?: string;
        monthlyRentMinor: number; currency?: string; leaseTermMonths?: number;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(estabLeaseProperties).values({
          id: p.id, tenantId: p.tenantId, propertyCode: p.propertyCode,
          propertyType: p.propertyType, location: p.location ?? null,
          area: p.area ?? null, areaUnit: p.areaUnit ?? "sqft",
          monthlyRentMinor: BigInt(p.monthlyRentMinor),
          currency: p.currency ?? "INR", leaseTermMonths: p.leaseTermMonths ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "lease_property_created", "lease_property", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "leasePropertyCreate failed"); }
  });

  // ── Create Lease ───────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.leaseCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; propertyId: string;
        tenantName: string; tenantPhone: string; tenantAadhaar?: string; tenantAddress?: unknown;
        leaseStartDate: string; leaseEndDate: string;
        monthlyRentMinor: number; securityDepositMinor?: number; currency?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const leaseNumber = generateLeaseNumber();
        await tx.insert(estabLeases).values({
          id: p.id, tenantId: p.tenantId, leaseNumber, propertyId: p.propertyId,
          tenantName: p.tenantName, tenantPhone: p.tenantPhone,
          tenantAadhaar: p.tenantAadhaar ?? null, tenantAddress: p.tenantAddress ?? null,
          leaseStartDate: p.leaseStartDate, leaseEndDate: p.leaseEndDate,
          monthlyRentMinor: BigInt(p.monthlyRentMinor),
          securityDepositMinor: p.securityDepositMinor != null ? BigInt(p.securityDepositMinor) : null,
          currency: p.currency ?? "INR", status: "active",
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        // Mark property as leased
        await tx.update(estabLeaseProperties)
          .set({ status: "leased", updatedBy: msg.actorId, updatedAt: new Date() })
          .where(and(eq(estabLeaseProperties.id, p.propertyId), eq(estabLeaseProperties.tenantId, p.tenantId)));

        await enqueue(tx, {
          topic: "estab.lease.created", eventType: "estab.lease.created",
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { leaseId: p.id, propertyId: p.propertyId, leaseNumber },
        });
        await audit(tx, msg, "lease_created", "lease", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "leaseCreate failed"); }
  });

  // ── Record Lease Payment ───────────────────────────────────────────────
  queue.subscribe(COMMANDS.leasePaymentRecord, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; leaseId: string; tenantId: string;
        paymentMonth: string; amountMinor: number; dueDate: string;
        paymentRef?: string; currency?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        // Look up lease for late fee calculation
        const leaseRows = await tx.select().from(estabLeases)
          .where(and(eq(estabLeases.id, p.leaseId), eq(estabLeases.tenantId, p.tenantId))).limit(1);
        const lease = leaseRows[0];
        if (!lease) throw new Error("LEASE_NOT_FOUND");

        const now = new Date();
        const dueDate = new Date(p.dueDate);
        const msPerDay = 86_400_000;
        const daysLate = Math.max(0, Math.ceil((now.getTime() - dueDate.getTime()) / msPerDay));
        const monthsOverdue = Math.ceil(daysLate / 30);
        const lateFee = calculateLateFee(lease.monthlyRentMinor, monthsOverdue);

        await tx.insert(estabLeasePayments).values({
          id: p.id, tenantId: p.tenantId, leaseId: p.leaseId,
          paymentMonth: p.paymentMonth, amountMinor: BigInt(p.amountMinor),
          currency: p.currency ?? "INR", dueDate: p.dueDate,
          paidAt: now, paymentRef: p.paymentRef ?? null,
          status: "paid", lateFeeMinor: lateFee,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });

        await enqueue(tx, {
          topic: "estab.lease_payment.recorded", eventType: "estab.lease_payment.recorded",
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { paymentId: p.id, leaseId: p.leaseId, amountMinor: p.amountMinor, lateFeeMinor: lateFee.toString() },
        });
        await audit(tx, msg, "lease_payment_recorded", "lease_payment", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "leasePaymentRecord failed"); }
  });

  // ── Submit Lease Request ───────────────────────────────────────────────
  queue.subscribe(COMMANDS.leaseRequestSubmit, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; leaseId: string;
        requestType: string; transfereeName?: string; transfereePhone?: string;
        transfereeAadhaar?: string; surrenderDate?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const requestNumber = generateRequestNumber();
        await tx.insert(estabLeaseRequests).values({
          id: p.id, tenantId: p.tenantId, leaseId: p.leaseId,
          requestType: p.requestType, requestNumber,
          requestedBy: msg.actorId, status: "submitted",
          transfereeName: p.transfereeName ?? null,
          transfereePhone: p.transfereePhone ?? null,
          transfereeAadhaar: p.transfereeAadhaar ?? null,
          surrenderDate: p.surrenderDate ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: "estab.lease_request.submitted", eventType: "estab.lease_request.submitted",
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { requestId: p.id, leaseId: p.leaseId, requestType: p.requestType, requestNumber },
        });
        await audit(tx, msg, "lease_request_submitted", "lease_request", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "leaseRequestSubmit failed"); }
  });

  // ── Review Lease Request (approve/reject) ──────────────────────────────
  queue.subscribe(COMMANDS.leaseRequestReview, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; decision: string; remarks?: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabLeaseRequests)
          .where(and(eq(estabLeaseRequests.id, p.id), eq(estabLeaseRequests.tenantId, p.tenantId))).limit(1);
        const request = rows[0];
        if (!request) throw new Error("REQUEST_NOT_FOUND");

        const targetStatus = p.decision === "approve" ? "approved" : "rejected";
        assertRequestTransition(request.status, targetStatus);

        await tx.update(estabLeaseRequests)
          .set({
            status: targetStatus, approvedBy: msg.actorId, approvedAt: new Date(),
            remarks: p.remarks ?? null,
            updatedBy: msg.actorId, updatedAt: new Date(),
            version: sql`${estabLeaseRequests.version} + 1`,
          })
          .where(eq(estabLeaseRequests.id, p.id));

        if (targetStatus === "approved") {
          await enqueue(tx, {
            topic: "estab.lease_request.approved", eventType: "estab.lease_request.approved",
            tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { requestId: p.id, leaseId: request.leaseId, requestType: request.requestType },
          });
        }
        await audit(tx, msg, `lease_request_${targetStatus}`, "lease_request", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "leaseRequestReview failed"); }
  });

  // ── Complete Lease Request ─────────────────────────────────────────────
  queue.subscribe(COMMANDS.leaseRequestComplete, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabLeaseRequests)
          .where(and(eq(estabLeaseRequests.id, p.id), eq(estabLeaseRequests.tenantId, p.tenantId))).limit(1);
        const request = rows[0];
        if (!request) throw new Error("REQUEST_NOT_FOUND");
        assertRequestTransition(request.status, "completed");

        await tx.update(estabLeaseRequests)
          .set({
            status: "completed", updatedBy: msg.actorId, updatedAt: new Date(),
            version: sql`${estabLeaseRequests.version} + 1`,
          })
          .where(eq(estabLeaseRequests.id, p.id));

        // Apply the lease state change based on request type
        const leaseRows = await tx.select().from(estabLeases)
          .where(and(eq(estabLeases.id, request.leaseId), eq(estabLeases.tenantId, p.tenantId))).limit(1);
        const lease = leaseRows[0];
        if (lease) {
          if (request.requestType === "renewal") {
            assertLeaseTransition(lease.status, "renewed");
            await tx.update(estabLeases)
              .set({
                status: "renewed", renewalCount: sql`${estabLeases.renewalCount} + 1`,
                updatedBy: msg.actorId, updatedAt: new Date(),
                version: sql`${estabLeases.version} + 1`,
              })
              .where(eq(estabLeases.id, lease.id));
          } else if (request.requestType === "transfer") {
            assertLeaseTransition(lease.status, "transferred");
            await tx.update(estabLeases)
              .set({ status: "transferred", updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${estabLeases.version} + 1` })
              .where(eq(estabLeases.id, lease.id));
          } else if (request.requestType === "surrender") {
            assertLeaseTransition(lease.status, "surrendered");
            await tx.update(estabLeases)
              .set({ status: "surrendered", updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${estabLeases.version} + 1` })
              .where(eq(estabLeases.id, lease.id));
            // Release the property
            await tx.update(estabLeaseProperties)
              .set({ status: "available", updatedBy: msg.actorId, updatedAt: new Date() })
              .where(eq(estabLeaseProperties.id, lease.propertyId));
          }
        }

        await enqueue(tx, {
          topic: "estab.lease_request.completed", eventType: "estab.lease_request.completed",
          tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { requestId: p.id, leaseId: request.leaseId, requestType: request.requestType },
        });
        await audit(tx, msg, "lease_request_completed", "lease_request", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "leaseRequestComplete failed"); }
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}
