/**
 * Quarters consumer — handles allotment workflow commands + licence-fee recovery.
 *
 * On occupation (quarterOccupy):
 *   1. Marks quarter as occupied
 *   2. Looks up effective licence-fee rate
 *   3. Publishes payroll.deduction.create for monthly licence-fee recovery
 *   4. Publishes finance.receivable.create for the receivable ledger
 *
 * Maker-checker enforcement: allotment command checks allotter ≠ applicant.
 * Idempotency: markProcessed on every command.
 * Audit: every state change emits audit.event.record.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { assertValidTransition, assertMakerChecker, computeEligibilityScore } from "./domain.js";
import { eq, and, sql } from "drizzle-orm";
import { estabQuarters, estabQuarterAllotments, estabLicenceFeeRates } from "./schema.js";

const log = pino({ name: "quarters-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const PAYROLL_DEDUCTION_TOPIC = "payroll.deduction.create";
const FINANCE_RECEIVABLE_TOPIC = "finance.receivable.create";

export function registerQuarterConsumers(queue: Queue): void {
  // ── Create Quarter ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.quarterCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; quarterNo: string; quarterType: string;
        category?: string; address?: string; locality?: string; carpetAreaSqft?: number; orgUnit?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(estabQuarters).values({
          id: p.id, tenantId: p.tenantId, quarterNo: p.quarterNo,
          quarterType: p.quarterType, category: p.category ?? "general",
          address: p.address ?? null, locality: p.locality ?? null,
          carpetAreaSqft: p.carpetAreaSqft ?? null, orgUnit: p.orgUnit ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "quarter_created", "quarter", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "quarterCreate failed"); }
  });

  // ── Apply for Allotment ────────────────────────────────────────────────
  queue.subscribe(COMMANDS.quarterApply, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; quarterId: string; employeeRef: string;
        designation?: string; payLevel?: string; seniorityMonths?: number;
      };
      const score = computeEligibilityScore(
        parseInt(p.payLevel ?? "0", 10) || 0,
        p.seniorityMonths ?? 0,
      );
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(estabQuarterAllotments).values({
          id: p.id, tenantId: p.tenantId, quarterId: p.quarterId,
          employeeRef: p.employeeRef, designation: p.designation ?? null,
          payLevel: p.payLevel ?? null, eligibilityScore: score,
          status: "applied", createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "allotment_applied", "quarter_allotment", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "quarterApply failed"); }
  });

  // ── Allot Quarter (maker-checker: allotter ≠ applicant) ────────────────
  queue.subscribe(COMMANDS.quarterAllot, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; version: number };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabQuarterAllotments)
          .where(and(eq(estabQuarterAllotments.id, p.id), eq(estabQuarterAllotments.tenantId, p.tenantId))).limit(1);
        const allotment = rows[0];
        if (!allotment) throw new Error("ALLOTMENT_NOT_FOUND");
        assertValidTransition(allotment.status, "allotted");
        assertMakerChecker(allotment.employeeRef, msg.actorId);
        await tx.update(estabQuarterAllotments)
          .set({ status: "allotted", allottedAt: new Date(), allottedBy: msg.actorId, updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${estabQuarterAllotments.version} + 1` })
          .where(and(eq(estabQuarterAllotments.id, p.id), eq(estabQuarterAllotments.version, p.version)));
        await tx.update(estabQuarters)
          .set({ status: "allotted", updatedBy: msg.actorId, updatedAt: new Date() })
          .where(eq(estabQuarters.id, allotment.quarterId));
        await audit(tx, msg, "allotment_allotted", "quarter_allotment", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "quarterAllot failed"); }
  });

  // ── Occupy Quarter → emit licence-fee deduction to payroll ─────────────
  queue.subscribe(COMMANDS.quarterOccupy, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; version: number };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabQuarterAllotments)
          .where(and(eq(estabQuarterAllotments.id, p.id), eq(estabQuarterAllotments.tenantId, p.tenantId))).limit(1);
        const allotment = rows[0];
        if (!allotment) throw new Error("ALLOTMENT_NOT_FOUND");
        assertValidTransition(allotment.status, "occupied");

        await tx.update(estabQuarterAllotments)
          .set({ status: "occupied", occupiedAt: new Date(), updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${estabQuarterAllotments.version} + 1` })
          .where(and(eq(estabQuarterAllotments.id, p.id), eq(estabQuarterAllotments.version, p.version)));
        await tx.update(estabQuarters)
          .set({ status: "occupied", updatedBy: msg.actorId, updatedAt: new Date() })
          .where(eq(estabQuarters.id, allotment.quarterId));

        // Look up the quarter type to find the licence-fee rate
        const qtrRows = await tx.select().from(estabQuarters)
          .where(eq(estabQuarters.id, allotment.quarterId)).limit(1);
        const quarter = qtrRows[0];
        if (quarter && allotment.payLevel) {
          const rateRows = await tx.select().from(estabLicenceFeeRates)
            .where(and(
              eq(estabLicenceFeeRates.tenantId, p.tenantId),
              eq(estabLicenceFeeRates.quarterType, quarter.quarterType),
              eq(estabLicenceFeeRates.payLevel, allotment.payLevel),
            )).limit(1);
          const rate = rateRows[0];
          if (rate) {
            // Emit payroll deduction command
            await enqueue(tx, {
              topic: PAYROLL_DEDUCTION_TOPIC, eventType: PAYROLL_DEDUCTION_TOPIC,
              tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: {
                employeeRef: allotment.employeeRef,
                deductionType: "quarter_licence_fee",
                amountMinor: rate.monthlyMinor.toString(),
                currency: rate.currency,
                effectiveFrom: new Date().toISOString().slice(0, 10),
                refType: "quarter_allotment",
                refId: p.id,
              },
            });
            // Emit finance receivable
            await enqueue(tx, {
              topic: FINANCE_RECEIVABLE_TOPIC, eventType: FINANCE_RECEIVABLE_TOPIC,
              tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
              payload: {
                debtorRef: allotment.employeeRef,
                debtorType: "employee",
                amountMinor: rate.monthlyMinor.toString(),
                currency: rate.currency,
                description: `Quarter licence fee - ${quarter.quarterNo}`,
                refType: "quarter_allotment",
                refId: p.id,
              },
            });
          }
        }
        await audit(tx, msg, "allotment_occupied", "quarter_allotment", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "quarterOccupy failed"); }
  });

  // ── Vacation Notice ────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.quarterVacationNotice, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; version: number; vacationDueDate: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabQuarterAllotments)
          .where(and(eq(estabQuarterAllotments.id, p.id), eq(estabQuarterAllotments.tenantId, p.tenantId))).limit(1);
        const allotment = rows[0];
        if (!allotment) throw new Error("ALLOTMENT_NOT_FOUND");
        assertValidTransition(allotment.status, "vacation_notice");
        await tx.update(estabQuarterAllotments)
          .set({ status: "vacation_notice", vacationNoticeAt: new Date(), vacationDueDate: p.vacationDueDate, updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${estabQuarterAllotments.version} + 1` })
          .where(and(eq(estabQuarterAllotments.id, p.id), eq(estabQuarterAllotments.version, p.version)));
        await audit(tx, msg, "vacation_notice_issued", "quarter_allotment", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "quarterVacationNotice failed"); }
  });

  // ── Vacate Quarter ─────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.quarterVacate, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; version: number; handoverNotes?: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabQuarterAllotments)
          .where(and(eq(estabQuarterAllotments.id, p.id), eq(estabQuarterAllotments.tenantId, p.tenantId))).limit(1);
        const allotment = rows[0];
        if (!allotment) throw new Error("ALLOTMENT_NOT_FOUND");
        assertValidTransition(allotment.status, "vacated");
        await tx.update(estabQuarterAllotments)
          .set({ status: "vacated", vacatedAt: new Date(), handoverNotes: p.handoverNotes ?? null, updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${estabQuarterAllotments.version} + 1` })
          .where(and(eq(estabQuarterAllotments.id, p.id), eq(estabQuarterAllotments.version, p.version)));
        await tx.update(estabQuarters)
          .set({ status: "vacant", updatedBy: msg.actorId, updatedAt: new Date() })
          .where(eq(estabQuarters.id, allotment.quarterId));
        await audit(tx, msg, "allotment_vacated", "quarter_allotment", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "quarterVacate failed"); }
  });

  // ── Create Licence-Fee Rate ────────────────────────────────────────────
  queue.subscribe(COMMANDS.quarterLicenceFeeRate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; quarterType: string; payLevel: string;
        monthlyMinor: number; currency: string; effectiveFrom: string; effectiveTo?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(estabLicenceFeeRates).values({
          id: p.id, tenantId: p.tenantId, quarterType: p.quarterType,
          payLevel: p.payLevel, monthlyMinor: BigInt(p.monthlyMinor),
          currency: p.currency, effectiveFrom: p.effectiveFrom,
          effectiveTo: p.effectiveTo ?? null, createdBy: msg.actorId,
        });
        await audit(tx, msg, "licence_fee_rate_created", "licence_fee_rate", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "quarterLicenceFeeRate failed"); }
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}
