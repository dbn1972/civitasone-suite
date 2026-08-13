import type { Queue } from "@civitasone/queue";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { instalmentPlans, instalments, writeOffs, recoveryReferrals } from "./schema.js";
import { waivers } from "../trade-license/schema.js";
import { dcbEntries } from "../assessment/schema.js";
import { generateInstalmentSchedule, validateWriteOff, assertMakerChecker } from "./domain.js";

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
      const balanceRows = await tx
        .select({ total: sql<bigint>`COALESCE(SUM(${dcbEntries.balanceMinor}), 0)` })
        .from(dcbEntries)
        .where(and(eq(dcbEntries.tenantId, msg.tenantId), eq(dcbEntries.assesseeId, assesseeId)));
      const outstanding = balanceRows[0]?.total ?? 0n;

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

      const { assesseeId, amountMinor, reason } = msg.payload as {
        assesseeId: string;
        amountMinor: string;
        reason: string;
      };

      const amount = BigInt(amountMinor);

      // Load outstanding balance for validation
      const balanceRows = await tx
        .select({ total: sql<bigint>`COALESCE(SUM(${dcbEntries.balanceMinor}), 0)` })
        .from(dcbEntries)
        .where(and(eq(dcbEntries.tenantId, msg.tenantId), eq(dcbEntries.assesseeId, assesseeId)));
      const outstanding = balanceRows[0]?.total ?? 0n;

      // Domain validation
      validateWriteOff(amount, outstanding);

      // Insert write-off (status: pending, makerUserId: actorId)
      await tx.insert(writeOffs).values({
        tenantId: msg.tenantId,
        assesseeId,
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
        payload: { service: SERVICE, action: "create", resourceType: "write_off", outcome: "success" },
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
        // Insert DCB entry (type: write_off) — reduces balance
        const balanceRows = await tx
          .select({ total: sql<bigint>`COALESCE(SUM(${dcbEntries.balanceMinor}), 0)` })
          .from(dcbEntries)
          .where(and(eq(dcbEntries.tenantId, msg.tenantId), eq(dcbEntries.assesseeId, writeOff.assesseeId)));
        const currentBalance = balanceRows[0]?.total ?? 0n;
        const newBalance = currentBalance - writeOff.amountMinor;

        await tx.insert(dcbEntries).values({
          tenantId: msg.tenantId,
          assesseeId: writeOff.assesseeId,
          demandId: writeOff.assesseeId, // linked through assessee outstanding
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
    const { demandId, amountMinor, reason } = msg.payload as {
      demandId: string;
      amountMinor: string;
      reason: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

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
        payload:       { service: SERVICE, action: "create", resourceType: "waiver", outcome: "success" },
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