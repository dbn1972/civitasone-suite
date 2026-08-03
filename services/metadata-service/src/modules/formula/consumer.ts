import type { Queue } from "@civitasone/queue";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { withTenant } from "../../shared/scope.js";
import { COMMANDS } from "../../topics.js";
import { formulaDefinitions } from "../entities/schema.js";

export function registerFormulaConsumers(q: Queue): void {
  q.subscribe(COMMANDS.FORMULA_CREATE, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; apiName: string; label: string;
      expression: string; returnType: string; description?: string | null;
    };
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(formulaDefinitions).values({
        id: p.id, tenantId: p.tenantId, apiName: p.apiName, label: p.label,
        expression: p.expression, returnType: p.returnType,
        description: p.description ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "create_formula", resourceType: "formula_definition", resourceId: p.id, outcome: "success" },
      });
    });
  });
}
