import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { exemptionCeilings } from "../fnf/schema.js";
import { perquisiteComponents, taxDeclarations } from "./schema.js";
import { hraExemptionMinor } from "./engine.js";
import { hraSlabPct, roundRupee } from "../payroll/domain.js";
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
      await audit(tx, msg, "upsert", "perquisite_component", p.id);
    });
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
async function computeHraClaimedMinor(
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

  const basicMinor = BigInt(emp.basicMinor);
  const daMinor = roundRupee((basicMinor * daRateBps) / 10000n);
  const salaryAnnualMinor = (basicMinor + daMinor) * 12n;
  const hraReceivedAnnualMinor = roundRupee((basicMinor * hraSlabPct(emp.cityClass, daRateBps)) / 100n) * 12n;

  return hraExemptionMinor(salaryAnnualMinor, hraReceivedAnnualMinor, rentPaidMinor, emp.cityClass === "X");
}
