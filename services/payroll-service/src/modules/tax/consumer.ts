import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { taxDeclarations } from "./schema.js";

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
