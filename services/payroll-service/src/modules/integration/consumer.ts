import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, COMMANDS } from "../../topics.js";
import * as lopRepo from "./lop-repo.js";
import * as statutoryRepo from "../statutory/repo.js";
import { computeGratuity } from "../payroll/domain.js";
import { computeLtcExemption } from "../tax/ltc-exemption.js";
import { ltcExemptions } from "../fnf/schema.js";
import { randomUUID } from "node:crypto";
import { enqueue } from "../../shared/outbox.js";

const AUDIT = "audit.event.record";

export function registerIntegrationConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.employeeCreated, async (msg) => {
    // Acknowledged: warm-cache for future payroll run input resolution.
    // Currently a no-op (data fetched via hrms-client at run time), but the
    // subscription is registered so the queue contract holds and messages don't
    // dead-letter.
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
    });
  });

  queue.subscribe(CONSUMED_EVENTS.leaveApproved, async (msg) => {
    const p = msg.payload as { employeeId: string; daysApplied: number; fromDate: string };
    const month = p.fromDate.slice(0, 7);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lopRepo.upsertLopDays(tx, msg.tenantId, p.employeeId, month, "leave", p.daysApplied);
    });
  });

  queue.subscribe(CONSUMED_EVENTS.attendanceMarked, async (msg) => {
    const p = msg.payload as { employeeId: string; attendanceDate: string; status: string };
    if (p.status !== "absent" && p.status !== "half_day") return;
    const month = p.attendanceDate.slice(0, 7);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lopRepo.upsertLopDays(tx, msg.tenantId, p.employeeId, month, "attendance", 1);
    });
  });

  queue.subscribe(CONSUMED_EVENTS.employeeSeparated, async (msg) => {
    const p = msg.payload as {
      employeeId: string; effectiveDate: string; basicMinor?: string; dateOfJoining?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const basicMinor = BigInt(p.basicMinor ?? "0");
      const join = new Date(p.dateOfJoining ?? p.effectiveDate);
      const sep = new Date(p.effectiveDate);
      const years = Math.max(0, (sep.getTime() - join.getTime()) / (365.25 * 86400000));
      // Gratuity emoluments = last Basic + DA (CCS/Gratuity Act). Resolve DA rate at separation.
      const daRows = (await tx.execute(sql`
        SELECT rate_bps FROM payroll.dearness_allowance_rates
        WHERE tenant_id = ${msg.tenantId}::uuid AND effective_from <= ${p.effectiveDate}::date
        ORDER BY effective_from DESC LIMIT 1
      `)) as unknown as Array<{ rate_bps: number | string }>;
      const daRateBps = daRows[0]?.rate_bps != null ? BigInt(daRows[0].rate_bps) : 0n;
      const lastDaMinor = (basicMinor * daRateBps) / 10000n;
      const gratuityMinor = computeGratuity(years, basicMinor, lastDaMinor);
      if (gratuityMinor <= 0n) return;
      await statutoryRepo.insertGratuity(tx, {
        id: randomUUID(),
        tenantId: msg.tenantId,
        employeeId: p.employeeId,
        separationRef: `separation:${p.effectiveDate}`,
        yearsOfService: years.toFixed(2),
        lastBasicMinor: basicMinor,
        gratuityMinor,
        currency: "INR",
        status: "computed",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "payroll", action: "gratuity_compute", resourceType: "gratuity", resourceId: p.employeeId, outcome: "success" },
      });

      // Publish F&F compute command so the FNF consumer can run full settlement
      await enqueue(tx, {
        topic: COMMANDS.fnfCompute,
        eventType: COMMANDS.fnfCompute,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          employeeId: p.employeeId,
          tenantId: msg.tenantId,
          separationDate: p.effectiveDate,
          separationType: "retirement",
        },
      });
    });
  });

  queue.subscribe(CONSUMED_EVENTS.financePaymentMade, async (msg) => {
    const p = msg.payload as { payrollRunId?: string; outcome?: string };
    if (!p.payrollRunId || p.outcome !== "success") return;
    const { markSlipsPaidForRun } = await import("../payroll/repo.js");
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await markSlipsPaidForRun(tx, p.payrollRunId!, msg.actorId);
    });
  });

  queue.subscribe(CONSUMED_EVENTS.ltcClaimApproved, async (msg) => {
    const p = msg.payload as {
      claimId: string;
      employeeId: string;
      claimType: string;
      approvedFareMinor: string;
      entitlementMinor: string;
      blockYear: string;
      ltcType: "hometown" | "all_india";
      usedInBlock: number;
    };
    // Only process LTC claims
    if (p.claimType !== "ltc") return;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const result = computeLtcExemption({
        approvedFareMinor: BigInt(p.approvedFareMinor),
        entitlementMinor: BigInt(p.entitlementMinor),
        ltcType: p.ltcType,
        blockYear: p.blockYear,
        usedInBlock: p.usedInBlock,
      });

      // Determine FY from current date
      const now = new Date();
      const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      const fy = `${fyStartYear}-${(fyStartYear + 1) % 100}`;

      await tx.insert(ltcExemptions).values({
        tenantId: msg.tenantId,
        employeeId: p.employeeId,
        fy,
        claimId: p.claimId,
        blockYear: p.blockYear,
        ltcType: p.ltcType,
        approvedFareMinor: BigInt(p.approvedFareMinor),
        exemptAmountMinor: result.exemptMinor,
      });

      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "payroll", action: "ltc_exemption_compute", resourceType: "ltc_exemption", resourceId: p.claimId, outcome: "success" },
      });
    });
  });
}
