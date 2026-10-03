import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { exemptionCeilings } from "../fnf/schema.js";
import { perquisiteComponents, taxDeclarations, taxDeclarationWindows } from "./schema.js";
import { sql } from "drizzle-orm";
import { decryptPii } from "../../shared/pii-crypto.js";
import { hraExemptionMinor } from "./engine.js";
import { govtHraMinor, roundRupee } from "../payroll/domain.js";
import { loadAllowanceRuleRows, resolveAllowanceRules } from "../pay-profiles/allowance-rules.js";
import { planEmployeePay } from "../pay-profiles/plan.js";
import { pino } from "pino";

const log = pino({ name: "payroll-tax-consumer" });
import { resolveDaRateBps } from "../payroll/consumer.js";
import { fetchPayrollInput } from "../../shared/hrms-client.js";

const AUDIT = "audit.event.record";

export function registerTaxConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.taxDeclarationSubmit, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      fy: string;
      regime: "old" | "new";
      section80c: number;
      section80d: number;
      otherDeductions: number;
      rentPaidMinor: number;
      prevEmployerSalaryMinor?: number;
      otherSourcesIncomeMinor?: number;
      perquisitesMinor?: number;
      landlordName?: string;
      landlordPanSealed?: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rentPaidMinor = BigInt(p.rentPaidMinor);
      // BUG-HRA-1: rentPaidMinor was captured/stored below but hraClaimed (the
      // actually-APPLIED Sec 10(13A) exemption) was never computed, so every
      // old-regime declarant's exemption silently stayed at the column
      // default (0) — overstating taxable income on every downstream reader
      // of this row (tax/routes.ts's income-tax listing + tax/computation,
      // and tax/form16.ts's Part B). Compute it here.
      const hraClaimed = await computeHraClaimedMinor(tx, p.tenantId, p.employeeId, p.regime, p.fy, rentPaidMinor);

      const fields = {
        regime: p.regime,
        section80c: BigInt(p.section80c),
        section80d: BigInt(p.section80d),
        otherDeductions: BigInt(p.otherDeductions),
        hraClaimed,
        rentPaidMinor,
        prevEmployerSalaryMinor: BigInt(p.prevEmployerSalaryMinor ?? 0),
        otherSourcesIncomeMinor: BigInt(p.otherSourcesIncomeMinor ?? 0),
        perquisitesMinor: BigInt(p.perquisitesMinor ?? 0),
        // GAP-PAYROLL-TAX-DECLARATION-02: undefined => the column is left untouched on a resubmit.
        ...(p.landlordName !== undefined ? { landlordName: p.landlordName } : {}),
        ...(p.landlordPanSealed !== undefined ? { landlordPan: decryptPii(p.landlordPanSealed) } : {}),
        updatedAt: new Date(),
        updatedBy: msg.actorId,
      };

      await tx.insert(taxDeclarations).values({
        id: p.id,
        tenantId: p.tenantId,
        employeeId: p.employeeId,
        fy: p.fy,
        ...fields,
        status: "submitted",
        createdBy: msg.actorId,
      }).onConflictDoUpdate({
        target: [taxDeclarations.tenantId, taxDeclarations.employeeId, taxDeclarations.fy],
        set: { ...fields, status: "submitted" },
      });

      await audit(tx, msg, "submit", "tax_declaration", p.id);
    });
  });

  queue.subscribe(COMMANDS.exemptionCeilingUpsert, async (msg) => {
    const p = msg.payload as {
      id: string;
      fyStartYear: number;
      section: "10_10" | "10_10AA" | "10_10B" | "10_10C";
      ceilingMinor: string;
      notes?: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await tx.insert(exemptionCeilings).values({
        id: p.id,
        fyStartYear: p.fyStartYear,
        section: p.section,
        ceilingMinor: BigInt(p.ceilingMinor),
        notes: p.notes ?? null,
      }).onConflictDoUpdate({
        target: [exemptionCeilings.fyStartYear, exemptionCeilings.section],
        set: {
          ceilingMinor: BigInt(p.ceilingMinor),
          notes: p.notes ?? null,
        },
      });

      await enqueue(tx, {
        topic: EVENTS.exemptionCeilingUpserted,
        eventType: EVENTS.exemptionCeilingUpserted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, fyStartYear: p.fyStartYear, section: p.section },
      });
      await audit(tx, msg, "upsert", "exemption_ceiling", p.id);
    });
  });

  queue.subscribe(COMMANDS.perquisiteComponentUpsert, async (msg) => {
    const p = msg.payload as {
      id: string;
      employeeId: string;
      fy: string;
      nature: string;
      description?: string;
      valueByEmployer: number;
      amountRecovered?: number;
    };

    const valueByEmployerMinor = BigInt(Math.round(p.valueByEmployer * 100));
    const amountRecoveredMinor = BigInt(Math.round((p.amountRecovered ?? 0) * 100));
    const taxableValueMinor = valueByEmployerMinor > amountRecoveredMinor
      ? valueByEmployerMinor - amountRecoveredMinor
      : 0n;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Audit the row that was ACTUALLY written (on an overwrite the existing
      // row keeps its own id, not the command's p.id) with before/after values.
      const snapshotSql = (employeeId: string) => sql`
        SELECT id::text AS id, description, value_by_employer_minor::text AS value_minor,
               amount_recovered_minor::text AS recovered_minor, taxable_value_minor::text AS taxable_minor
          FROM payroll.perquisite_components
         WHERE tenant_id = ${msg.tenantId}::uuid AND employee_id = ${employeeId}::uuid
           AND fy = ${p.fy} AND nature = ${p.nature}`;
      type Snap = { id: string; description: string; value_minor: string; recovered_minor: string; taxable_minor: string };
      const beforeRows = ((await tx.execute(sql`${snapshotSql(p.employeeId)} FOR UPDATE`)) ?? []) as unknown as Snap[];
      const before = Array.isArray(beforeRows) ? beforeRows[0] : undefined;

      await tx.insert(perquisiteComponents).values({
        id: p.id,
        tenantId: msg.tenantId,
        employeeId: p.employeeId,
        fy: p.fy,
        nature: p.nature,
        description: p.description ?? "",
        valueByEmployerMinor,
        amountRecoveredMinor,
        taxableValueMinor,
        createdBy: msg.actorId,
      }).onConflictDoUpdate({
        target: [
          perquisiteComponents.tenantId,
          perquisiteComponents.employeeId,
          perquisiteComponents.fy,
          perquisiteComponents.nature,
        ],
        set: {
          description: p.description ?? "",
          valueByEmployerMinor,
          amountRecoveredMinor,
          taxableValueMinor,
        },
      });

      await enqueue(tx, {
        topic: EVENTS.perquisiteComponentUpserted,
        eventType: EVENTS.perquisiteComponentUpserted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          employeeId: p.employeeId,
          fy: p.fy,
          nature: p.nature,
          taxableValueMinor: taxableValueMinor.toString(),
        },
      });
      const afterRows = ((await tx.execute(snapshotSql(p.employeeId))) ?? []) as unknown as Snap[];
      const after = Array.isArray(afterRows) ? afterRows[0] : undefined;
      const writtenId = after?.id ?? p.id;
      const view = (r: Snap | undefined) => r
        ? { description: r.description, valueByEmployerMinor: r.value_minor, amountRecoveredMinor: r.recovered_minor, taxableValueMinor: r.taxable_minor }
        : null;
      await auditDetail(tx, msg, before ? "update" : "create", "perquisite_component", writtenId, {
        employeeId: p.employeeId, fy: p.fy, nature: p.nature,
        before: view(before),
        after: view(after) ?? { description: p.description ?? "", valueByEmployerMinor: valueByEmployerMinor.toString(), amountRecoveredMinor: amountRecoveredMinor.toString(), taxableValueMinor: taxableValueMinor.toString() },
      });
    });
  });

  // GAP-PAYROLL-TAX-DECLARATION-05: per-FY submission window (payroll_admin).
  queue.subscribe(COMMANDS.taxDeclarationWindowSet, async (msg) => {
    const p = msg.payload as { id: string; fy: string; opensOn?: string | null; closesOn: string; changeReason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const prev = (await tx.execute(sql`
        SELECT opens_on::text AS opens_on, closes_on::text AS closes_on
          FROM payroll.tax_declaration_windows
         WHERE tenant_id = ${msg.tenantId}::uuid AND fy = ${p.fy} FOR UPDATE
      `)) as unknown as Array<{ opens_on: string | null; closes_on: string }>;
      await tx.insert(taxDeclarationWindows).values({
        tenantId: msg.tenantId, fy: p.fy, opensOn: p.opensOn ?? null, closesOn: p.closesOn,
        changeReason: p.changeReason, updatedBy: msg.actorId,
      }).onConflictDoUpdate({
        target: [taxDeclarationWindows.tenantId, taxDeclarationWindows.fy],
        set: { opensOn: p.opensOn ?? null, closesOn: p.closesOn, changeReason: p.changeReason, updatedBy: msg.actorId, updatedAt: new Date() },
      });
      await auditDetail(tx, msg, "set_window", "tax_declaration_window", `${msg.tenantId}:${p.fy}`, {
        fy: p.fy, reason: p.changeReason,
        before: prev[0] ? { opensOn: prev[0].opens_on, closesOn: prev[0].closes_on } : null,
        after: { opensOn: p.opensOn ?? null, closesOn: p.closesOn },
      });
    });
  });

  // GAP-PAYROLL-STATUTORY-PERQUISITE-06: remove a mistaken component. The
  // audit row carries the deleted values, so a delete stays reconstructable.
  queue.subscribe(COMMANDS.perquisiteComponentDelete, async (msg) => {
    const p = msg.payload as { id: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const deleted = (await tx.execute(sql`
        DELETE FROM payroll.perquisite_components
         WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid
        RETURNING employee_id::text AS employee_id, fy, nature,
                  value_by_employer_minor::text AS value_minor, amount_recovered_minor::text AS recovered_minor,
                  taxable_value_minor::text AS taxable_minor
      `)) as unknown as Array<{ employee_id: string; fy: string; nature: string; value_minor: string; recovered_minor: string; taxable_minor: string }>;
      if (deleted.length === 0) return; // already gone: idempotent
      const d = deleted[0]!;
      await auditDetail(tx, msg, "delete", "perquisite_component", p.id, {
        reason: p.reason, employeeId: d.employee_id, fy: d.fy, nature: d.nature,
        valueByEmployerMinor: d.value_minor, amountRecoveredMinor: d.recovered_minor, taxableValueMinor: d.taxable_minor,
      });
    });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function auditDetail(tx: any, msg: any, action: string, resourceType: string, resourceId: string, details: Record<string, unknown>): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { ...details, service: "payroll", action, resourceType, resourceId, outcome: "success" },
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "payroll", action, resourceType, resourceId, outcome: "success" },
  });
}

/**
 * Sec 10(13A) HRA exemption for a submitted declaration — OLD REGIME ONLY;
 * the new regime disallows this exemption entirely (Income-tax Act post-2020
 * regime rules — mirrors tax/form16.ts's identical `isOld ? ... : 0n` gate).
 * Reuses payroll/domain.ts's computeSlip() building blocks (hraSlabPct — the
 * 7th-CPC city-class HRA slab — and payroll/consumer.ts's resolveDaRateBps,
 * the same DA-rate resolver a live payroll run uses) plus engine.ts's
 * hraExemptionMinor() least-of-three formula, so this stored FY-declaration
 * figure doesn't drift from what a run for the same employee independently
 * derives.
 *
 * Resolved as of the FY's last month (March of startYear+1) — the same
 * FY-snapshot convention tax/routes.ts's resolveDeductionCapsRupees() already
 * uses for FY-scoped config — rather than "whenever this command happens to
 * run," so a late/retroactive declaration for a past FY isn't computed
 * against today's unrelated basic/DA.
 *
 * Deliberately THROWS (rolling back this transaction so the queue retries)
 * rather than ever falling back to a silent hraClaimed=0 for an old-regime
 * employee who declared rent — a silent zero here is exactly BUG-HRA-1
 * (declared rent captured, exemption never applied). "No rent declared" is
 * the one legitimate 0n case, short-circuited before any lookup.
 */
export async function computeHraClaimedMinor(
  tx: Parameters<typeof resolveDaRateBps>[0],
  tenantId: string,
  employeeId: string,
  regime: "old" | "new",
  fy: string,
  rentPaidMinor: bigint,
): Promise<bigint> {
  if (regime !== "old" || rentPaidMinor <= 0n) return 0n;

  const startYear = parseInt(fy.slice(0, 4), 10);
  const month = `${startYear + 1}-03`; // FY-end snapshot — see tax/routes.ts's resolveDeductionCapsRupees()

  const daRateBps = await resolveDaRateBps(tx, tenantId, month);
  const input = await fetchPayrollInput(tenantId, month);
  const emp = input.employees.find((e) => e.id === employeeId);
  if (!emp) {
    throw new Error(
      `HRA_EXEMPTION_INPUT_MISSING: employee ${employeeId} not found in HRMS payroll input for ${month}; cannot compute Sec 10(13A) HRA exemption for this old-regime declaration`,
    );
  }

  // PAY-PROFILES: derive basic / DA rate / HRA exactly as the payroll run
  // does for this employee's pay profile (parent or post basic for a
  // deputationist, parent-State DA when recorded, the HRA minimum floor in
  // force for the month). Consolidated pay carries no HRA, so no exemption.
  const rules = resolveAllowanceRules(await loadAllowanceRuleRows(tx, tenantId), tenantId, month);
  // Never throws on a profile problem (a declaration must always process):
  //  - ctc_contract: its HRA comes from the CTC structure (PR3) -> 0n here;
  //  - consolidated pay has no HRA -> 0n;
  //  - a deputation profile that no longer applies (lapsed / repatriated /
  //    incomplete terms): fall back to the government-scale computation on
  //    the HRMS basic and central DA, and log an advisory.
  if (emp.payProfile?.profile === "ctc_contract") return 0n;
  const planned = planEmployeePay(emp, month, daRateBps, rules);
  let basicMinor: bigint;
  let empDaRateBps: bigint;
  let floorMinor: bigint;
  if (planned.ok) {
    if (planned.plan.profile === "consolidated_contract") return 0n;
    basicMinor = planned.plan.profileBasicMinor;
    empDaRateBps = planned.plan.daRateBps;
    floorMinor = planned.plan.hraFloorMinor;
  } else {
    log.warn({ tenantId, employeeId, code: planned.code, month }, "HRA exemption: pay profile not applicable for the FY snapshot month; computed on the government-scale basis (advisory)");
    basicMinor = BigInt(emp.basicMinor);
    empDaRateBps = daRateBps;
    floorMinor = rules.hraFloorMinor[emp.cityClass];
  }

  const daMinor = roundRupee((basicMinor * empDaRateBps) / 10000n);
  const salaryAnnualMinor = (basicMinor + daMinor) * 12n;
  const hraReceivedAnnualMinor = govtHraMinor(basicMinor, emp.cityClass, empDaRateBps, floorMinor) * 12n;

  return hraExemptionMinor(salaryAnnualMinor, hraReceivedAnnualMinor, rentPaidMinor, emp.cityClass === "X");
}
