import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { exemptionCeilings } from "../fnf/schema.js";
import { perquisiteComponents, taxDeclarations } from "./schema.js";

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

      const fields = {
        regime: p.regime,
        section80c: BigInt(p.section80c),
        section80d: BigInt(p.section80d),
        otherDeductions: BigInt(p.otherDeductions),
        rentPaidMinor: BigInt(p.rentPaidMinor),
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
