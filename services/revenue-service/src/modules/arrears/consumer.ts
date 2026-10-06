import type { Queue } from "@civitasone/queue";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { instalmentPlans, instalments, writeOffs, recoveryReferrals } from "./schema.js";
import { waivers } from "../trade-license/schema.js";
import { dcbEntries, demands } from "../assessment/schema.js";
import { getAssesseeOutstanding, getLatestDemandBalance } from "./outstanding.js";
import {
  generateInstalmentSchedule,
  validateWriteOff,
  assertMakerChecker,
  validateRecoveryReferral,
  validateWaiver,
  waiverCap,
  DomainError,
  type WaiverComponent,
} from "./domain.js";

export function registerArrearsConsumers(queue: Queue): void {
  // ── instalmentPlanCreate ────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.instalmentPlanCreate, async (msg) => {
    const { assesseeId, instalmentCount, startDate } = msg.payload as {
      assesseeId: string;
      instalmentCount: number;
      startDate: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Load outstanding balance for the assessee from DCB
      const outstanding = await getAssesseeOutstanding(tx, msg.tenantId, assesseeId);

      // Generate instalment schedule from domain
      const schedule = generateInstalmentSchedule(outstanding, instalmentCount, startDate);

      // Insert instalment plan
      const planRows = await tx.insert(instalmentPlans).values({
        tenantId: msg.tenantId,
        assesseeId,
        totalMinor: outstanding,
        instalmentCount,
        startDate,
        status: "active",
        createdBy: msg.actorId,
      }).returning({ id: instalmentPlans.id });
      const planId = planRows[0]!.id;

      // Insert individual instalments
      for (const entry of schedule) {
        await tx.insert(instalments).values({
          tenantId: msg.tenantId,
          planId,
          sequenceNo: entry.sequenceNo,
          dueDate: entry.dueDate,
          amountMinor: entry.amountMinor,
        });
      }

      // Enqueue events
      await enqueue(tx, {
        topic: EVENTS.instalmentPlanCreated,
        eventType: EVENTS.instalmentPlanCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { planId, assesseeId, instalmentCount, startDate, totalMinor: outstanding.toString() },
      });
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: SERVICE, action: "create", resourceType: "instalment_plan", outcome: "success" },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:instalments:${assesseeId}`);
  });

  // ── writeOffCreate ──────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.writeOffCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const { assesseeId, amountMinor, reason, demandId, financialYear } = msg.payload as {
        assesseeId: string;
        amountMinor: string;
        reason: string;
        demandId?: string;
        financialYear?: string;
      };

      const amount = BigInt(amountMinor);

      // Load outstanding balance for validation
      const outstanding = await getAssesseeOutstanding(tx, msg.tenantId, assesseeId);

      // Domain validation
      validateWriteOff(amount, outstanding);

      // Insert write-off (status: pending, makerUserId: actorId)
      await tx.insert(writeOffs).values({
        tenantId: msg.tenantId,
        assesseeId,
        demandId: demandId ?? null,
        financialYear: financialYear ?? null,
        amountMinor: amount,
        reason,
        status: "pending",
        makerUserId: msg.actorId,
      });

      // Audit
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: SERVICE, action: "create", resourceType: "write_off", outcome: "success", demandId: demandId ?? null, financialYear: financialYear ?? null },
      });
    });
  });

  // ── writeOffDecide ──────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.writeOffDecide, async (msg) => {
    const { writeOffId, approve, reason } = msg.payload as {
      writeOffId: string;
      approve: boolean;
      reason?: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Load write-off
      const writeOffRows = await tx
        .select()
        .from(writeOffs)
        .where(and(eq(writeOffs.tenantId, msg.tenantId), eq(writeOffs.id, writeOffId)))
        .limit(1);
      const writeOff = writeOffRows[0];
      if (!writeOff) return;

      // Maker-checker enforcement
      assertMakerChecker(writeOff.makerUserId, msg.actorId);

      const newStatus = approve ? "approved" : "rejected";
      await tx
        .update(writeOffs)
        .set({
          status: newStatus,
          checkerUserId: msg.actorId,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(writeOffs.id, writeOffId));

      if (approve) {
        // Insert DCB entry (type: write_off) — reduces balance. dcb balances are
        // per-demand running balances, so chain onto the written-off demand's
        // own ledger (or, for a legacy write-off with no demand, the assessee
        // pseudo-ledger), never the assessee total: otherwise the outstanding
        // sum (latest entry per demand) would double count.
        const targetDemandId = writeOff.demandId ?? writeOff.assesseeId;
        const currentBalance = await getLatestDemandBalance(tx, msg.tenantId, targetDemandId);
        const newBalance = currentBalance - writeOff.amountMinor;

        await tx.insert(dcbEntries).values({
          tenantId: msg.tenantId,
          assesseeId: writeOff.assesseeId,
          demandId: targetDemandId,
          entryType: "write_off",
          amountMinor: writeOff.amountMinor,
          balanceMinor: newBalance,
          referenceId: writeOffId,
          referenceType: "write_off",
          narration: `Write-off approved: ${reason ?? writeOff.reason}`,
          createdBy: msg.actorId,
        });

        await enqueue(tx, {
          topic: EVENTS.writeOffApplied,
          eventType: EVENTS.writeOffApplied,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { writeOffId, assesseeId: writeOff.assesseeId, amountMinor: writeOff.amountMinor.toString() },
        });
      }

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: SERVICE, action: "decide", resourceType: "write_off", outcome: newStatus },
      });
    });

    // Invalidate caches
    const writeOffRows = await db
      .select({ assesseeId: writeOffs.assesseeId })
      .from(writeOffs)
      .where(eq(writeOffs.id, writeOffId))
      .limit(1);
    const assesseeId = writeOffRows[0]?.assesseeId;
    if (assesseeId) {
      await cache.invalidate(`${SERVICE}:${msg.tenantId}:instalments:${assesseeId}`);
      await cache.invalidate(`${SERVICE}:${msg.tenantId}:dcb:${assesseeId}`);
    }
  });

  // ── recoveryRefer ───────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.recoveryRefer, async (msg) => {
    const { assesseeId, reason } = msg.payload as {
      assesseeId: string;
      reason: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // GAP-REVENUE-RECOVERY-01: never refer an assessee with no outstanding
      // arrears for coercive recovery. Fail closed on the current DCB balance.
      const outstanding = await getAssesseeOutstanding(tx, msg.tenantId, assesseeId);
      validateRecoveryReferral(BigInt(outstanding));

      // Insert recovery referral
      await tx.insert(recoveryReferrals).values({
        tenantId: msg.tenantId,
        assesseeId,
        reason,
        status: "referred",
        createdBy: msg.actorId,
      });

      // Enqueue events
      await enqueue(tx, {
        topic: EVENTS.recoveryReferred,
        eventType: EVENTS.recoveryReferred,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { assesseeId, reason },
      });
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: SERVICE, action: "create", resourceType: "recovery_referral", outcome: "success" },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:instalments:${assesseeId}`);
  });

  // ── waiverCreate ────────────────────────────────────────────────────────────
  queue.subscribe("revenue.waiver.create", async (msg) => {
    const { demandId, amountMinor, reason, waiverType } = msg.payload as {
      demandId: string;
      amountMinor: string;
      reason: string;
      waiverType?: WaiverComponent;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // GAP-REVENUE-WAIVERS-01 (server-side cap): the penalty/interest cap was
      // previously enforced ONLY in the web form, so a crafted API request
      // could waive more than the demand's accrued penalty/interest (or a
      // non-positive amount). Enforce it here, the command authority: load the
      // tenant-scoped demand, cap at the chosen component(s), and reject
      // (fail closed) if the demand is missing or the amount is over the cap.
      const demandRows = await tx
        .select({ penaltyMinor: demands.penaltyMinor, interestMinor: demands.interestMinor })
        .from(demands)
        .where(and(eq(demands.tenantId, msg.tenantId), eq(demands.id, demandId)))
        .limit(1);
      const demand = demandRows[0];
      if (!demand) {
        throw new DomainError("DEMAND_NOT_FOUND", `Demand ${demandId} not found for this tenant`);
      }
      const component: WaiverComponent = waiverType ?? "both";
      const componentCap = waiverCap(component, BigInt(demand.penaltyMinor), BigInt(demand.interestMinor));
      // The cap is per DEMAND, not per request: subtract everything already
      // waived (pending + approved) on this demand, otherwise N requests of up
      // to the cap each would pass. Earlier waivers carry no component, so they
      // count against whichever component is requested (conservative).
      const waivedRows = await tx
        .select({ total: sql<string>`COALESCE(SUM(CAST(${waivers.amountMinor} AS numeric)), 0)::text` })
        .from(waivers)
        .where(
          and(
            eq(waivers.tenantId, msg.tenantId),
            eq(waivers.demandId, demandId),
            sql`${waivers.status} IN ('pending', 'approved')`,
          ),
        );
      const alreadyWaived = BigInt(String(waivedRows[0]?.total ?? "0").split(".")[0] || "0");
      const cap = componentCap > alreadyWaived ? componentCap - alreadyWaived : 0n;
      validateWaiver(BigInt(amountMinor), cap);

      await tx.insert(waivers).values({
        tenantId:    msg.tenantId,
        demandId,
        amountMinor: String(amountMinor),
        reason,
        status:      "pending",
        requestedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic:         "audit.event.record",
        eventType:     "audit.event.record",
        tenantId:      msg.tenantId,
        actorId:       msg.actorId,
        correlationId: msg.correlationId,
        payload:       {
          service: SERVICE, action: "create", resourceType: "waiver", outcome: "success",
          demandId, amountMinor: String(amountMinor), waiverType: component,
        },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:waivers`);
  });

  // ── waiverDecide ─────────────────────────────────────────────────────────────
  queue.subscribe("revenue.waiver.decide", async (msg) => {
    const { waiverId, approve, reason } = msg.payload as {
      waiverId: string;
      approve: boolean;
      reason?: string;
    };

    const newStatus = approve ? "approved" : "rejected";

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // GAP-REVENUE-WAIVERS-03: enforce maker != checker server-side (the UI
      // also hides the controls, but the server is the authority). Only decide a
      // still-pending waiver raised by a DIFFERENT officer; otherwise leave it
      // untouched and record the rejected attempt in the audit trail.
      const existing = await tx
        .select({ requestedBy: waivers.requestedBy, status: waivers.status })
        .from(waivers)
        .where(and(eq(waivers.tenantId, msg.tenantId), eq(waivers.id, waiverId)))
        .limit(1);
      const row = existing[0];
      const sameOfficer = !!row && row.requestedBy === msg.actorId;
      const notPending = !!row && row.status !== "pending";
      if (!row || sameOfficer || notPending) {
        await enqueue(tx, {
          topic:         "audit.event.record",
          eventType:     "audit.event.record",
          tenantId:      msg.tenantId,
          actorId:       msg.actorId,
          correlationId: msg.correlationId,
          payload:       {
            service: SERVICE,
            action: "decide",
            resourceType: "waiver",
            outcome: !row ? "not_found" : sameOfficer ? "maker_checker_violation" : "already_decided",
          },
        });
        return;
      }

      await tx
        .update(waivers)
        .set({
          status:          newStatus,
          decidedBy:       msg.actorId,
          decidedAt:       new Date(),
          decisionRemarks: reason ?? null,
          updatedAt:       new Date(),
        })
        .where(and(eq(waivers.tenantId, msg.tenantId), eq(waivers.id, waiverId)));

      await enqueue(tx, {
        topic:         "audit.event.record",
        eventType:     "audit.event.record",
        tenantId:      msg.tenantId,
        actorId:       msg.actorId,
        correlationId: msg.correlationId,
        payload:       { service: SERVICE, action: "decide", resourceType: "waiver", outcome: newStatus },
      });
    });

    await cache.invalidate(`${SERVICE}:${msg.tenantId}:waivers`);
  });

}