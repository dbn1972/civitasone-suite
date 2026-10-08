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
import { assertValidTransition, assertMakerChecker, computeEligibilityScore, findApplicableRate, computeOverstayPenalty } from "./domain.js";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { estabQuarters, estabQuarterAllotments, estabLicenceFeeRates, estabOverstayPenalties } from "./schema.js";

const log = pino({ name: "quarters-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const PAYROLL_DEDUCTION_TOPIC = "payroll.deduction.create";
const FINANCE_RECEIVABLE_TOPIC = "finance.receivable.create";

/**
 * Current calendar date in IST (Asia/Kolkata, UTC+5:30) as an ISO yyyy-mm-dd
 * string. Occupation/vacation effective dates are business dates in IST, not
 * UTC — using the raw UTC date can roll a late-evening IST action onto the
 * wrong day and pick the wrong effective-dated rate.
 */
function istDateIso(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  return ist.toISOString().slice(0, 10);
}

/**
 * Derive the per-day licence fee (paise, integer floor) from the monthly rate
 * using the actual number of days in the overstay month. Integer math only
 * (money is bigint paise end to end).
 */
function dailyRateFromMonthly(monthlyMinor: bigint, onDate: Date): bigint {
  const daysInMonth = new Date(onDate.getUTCFullYear(), onDate.getUTCMonth() + 1, 0).getUTCDate();
  return monthlyMinor / BigInt(daysInMonth);
}

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
          // GAP2-ESTAB-QUARTERS-LICENCE-FEE-01: the rate table is effective-dated
          // and has no unique constraint on (tenant, quarter_type, pay_level), so
          // a bare .limit(1) returns an ARBITRARY row (possibly expired or not yet
          // effective) once a fee revision adds a second row. Fetch ALL candidate
          // rates and resolve the one applicable on the occupation date with the
          // pure effective-dating helper, so the correct monthly amount is pushed
          // into payroll + finance.
          const occupationDateIso = istDateIso(new Date());
          const rateRows = await tx.select().from(estabLicenceFeeRates)
            .where(and(
              eq(estabLicenceFeeRates.tenantId, p.tenantId),
              eq(estabLicenceFeeRates.quarterType, quarter.quarterType),
              eq(estabLicenceFeeRates.payLevel, allotment.payLevel),
            ));
          const rate = findApplicableRate(rateRows, occupationDateIso);
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
                effectiveFrom: occupationDateIso,
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
        const vacatedAt = new Date();
        await tx.update(estabQuarterAllotments)
          .set({ status: "vacated", vacatedAt, handoverNotes: p.handoverNotes ?? null, updatedBy: msg.actorId, updatedAt: new Date(), version: sql`${estabQuarterAllotments.version} + 1` })
          .where(and(eq(estabQuarterAllotments.id, p.id), eq(estabQuarterAllotments.version, p.version)));
        await tx.update(estabQuarters)
          .set({ status: "vacant", updatedBy: msg.actorId, updatedAt: new Date() })
          .where(eq(estabQuarters.id, allotment.quarterId));
        await audit(tx, msg, "allotment_vacated", "quarter_allotment", p.id);

        // GAP2-ESTAB-QUARTERS-OVERSTAY-01: if the occupant vacated after the
        // vacation_due_date, recover an overstay penalty. The feature (table +
        // domain fn) existed but had no insert/recovery path, a direct
        // revenue leak. Compute the penalty, persist one estab_overstay_penalties
        // row (audited in the same tx) and emit a finance receivable for
        // recovery. The daily rate is derived from the effective-dated licence
        // fee for this quarter type + pay level on the due date.
        if (allotment.vacationDueDate) {
          const dueDate = new Date(`${allotment.vacationDueDate}T00:00:00.000Z`);
          const { penaltyDays } = computeOverstayPenalty(dueDate, vacatedAt, 1n, 1);
          if (penaltyDays > 0 && allotment.payLevel) {
            const qtrRows = await tx.select().from(estabQuarters)
              .where(eq(estabQuarters.id, allotment.quarterId)).limit(1);
            const quarter = qtrRows[0];
            if (quarter) {
              const rateRows = await tx.select().from(estabLicenceFeeRates)
                .where(and(
                  eq(estabLicenceFeeRates.tenantId, p.tenantId),
                  eq(estabLicenceFeeRates.quarterType, quarter.quarterType),
                  eq(estabLicenceFeeRates.payLevel, allotment.payLevel),
                ));
              const rate = findApplicableRate(rateRows, allotment.vacationDueDate);
              if (rate) {
                const dailyRateMinor = dailyRateFromMonthly(rate.monthlyMinor, dueDate);
                const multiplier = Number(process.env.ESTAB_OVERSTAY_MULTIPLIER ?? "2");
                const { totalMinor } = computeOverstayPenalty(dueDate, vacatedAt, dailyRateMinor, multiplier);
                const penaltyId = randomUUID();
                await tx.insert(estabOverstayPenalties).values({
                  id: penaltyId, tenantId: p.tenantId, allotmentId: p.id,
                  employeeRef: allotment.employeeRef, penaltyDays,
                  dailyRateMinor, multiplier: multiplier.toFixed(2),
                  totalMinor, currency: rate.currency, status: "pending",
                  createdBy: msg.actorId,
                });
                await enqueue(tx, {
                  topic: FINANCE_RECEIVABLE_TOPIC, eventType: FINANCE_RECEIVABLE_TOPIC,
                  tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                  payload: {
                    debtorRef: allotment.employeeRef,
                    debtorType: "employee",
                    amountMinor: totalMinor.toString(),
                    currency: rate.currency,
                    description: `Quarter overstay penalty (${penaltyDays} day(s)) - ${quarter.quarterNo}`,
                    refType: "quarter_overstay_penalty",
                    refId: penaltyId,
                  },
                });
                await audit(tx, msg, "overstay_penalty_raised", "overstay_penalty", penaltyId);
              }
            }
          }
        }
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "quarterVacate failed"); }
  });

  // ── Cancel / Reject Allotment (GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-05) ───
  queue.subscribe(COMMANDS.quarterCancel, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; version: number; cancelReason: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.select().from(estabQuarterAllotments)
          .where(and(eq(estabQuarterAllotments.id, p.id), eq(estabQuarterAllotments.tenantId, p.tenantId))).limit(1);
        const allotment = rows[0];
        if (!allotment) throw new Error("ALLOTMENT_NOT_FOUND");
        assertValidTransition(allotment.status, "cancelled");
        await tx.update(estabQuarterAllotments)
          .set({
            status: "cancelled",
            cancelledAt: new Date(),
            cancelReason: p.cancelReason,
            updatedBy: msg.actorId,
            updatedAt: new Date(),
            version: sql`${estabQuarterAllotments.version} + 1`,
          })
          .where(and(eq(estabQuarterAllotments.id, p.id), eq(estabQuarterAllotments.version, p.version)));
        // If the allotment was "allotted", the quarter should revert to vacant.
        if (allotment.status === "allotted") {
          await tx.update(estabQuarters)
            .set({ status: "vacant", updatedBy: msg.actorId, updatedAt: new Date() })
            .where(eq(estabQuarters.id, allotment.quarterId));
        }
        await audit(tx, msg, "allotment_cancelled", "quarter_allotment", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "quarterCancel failed"); }
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
