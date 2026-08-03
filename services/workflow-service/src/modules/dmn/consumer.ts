import type { CommandEnvelope, Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { subscribeWithDlq } from "../dlq/wrap.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { dmnTables } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";
type Payload = Record<string, unknown> & { id: string; tenantId: string };
async function emit(tx: Parameters<typeof enqueue>[0], msg: CommandEnvelope, topic: string, action: string, id: string): Promise<void> {
  await enqueue(tx, { topic, eventType: topic, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { tableId: id } });
  await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow", action, resourceType: "dmn_table", resourceId: id, outcome: "success" } });
}
export function registerDmnConsumers(queue: Queue): void {
  queue = tenantScoped(queue);
  subscribeWithDlq<Payload>(queue, COMMANDS.createDmnTable, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; const p = msg.payload;
      await tx.insert(dmnTables).values({ id: p.id, tenantId: p.tenantId, name: p.name as string, description: p.description as string | null, hitPolicy: p.hitPolicy as string, inputs: p.inputs as never, outputs: p.outputs as never, rules: p.rules as never, status: "draft", version: 1, createdBy: msg.actorId, updatedBy: msg.actorId });
      await emit(tx, msg, EVENTS.dmnTableCreated, "create", p.id);
    });
  });
  subscribeWithDlq<Payload>(queue, COMMANDS.updateDmnTable, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; const p = msg.payload;
      const rows = await tx.select().from(dmnTables).where(and(eq(dmnTables.id, p.id), eq(dmnTables.tenantId, p.tenantId))).limit(1); const row = rows[0];
      if (!row || row.status === "deleted" || row.version !== p.version) return;
      const patch: Record<string, unknown> = { version: row.version + 1, updatedAt: new Date(), updatedBy: msg.actorId };
      for (const key of ["name", "description", "hitPolicy", "inputs", "outputs", "rules"]) if (p[key] !== undefined) patch[key] = p[key];
      await tx.update(dmnTables).set(patch).where(eq(dmnTables.id, p.id)); await emit(tx, msg, EVENTS.dmnTableUpdated, "update", p.id);
    });
  });
  subscribeWithDlq<Payload>(queue, COMMANDS.deleteDmnTable, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; const p = msg.payload;
      const rows = await tx.select().from(dmnTables).where(and(eq(dmnTables.id, p.id), eq(dmnTables.tenantId, p.tenantId))).limit(1);
      if (!rows[0] || rows[0].status === "deleted") return;
      await tx.update(dmnTables).set({ status: "deleted", updatedAt: new Date(), updatedBy: msg.actorId }).where(eq(dmnTables.id, p.id)); await emit(tx, msg, EVENTS.dmnTableDeleted, "delete", p.id);
    });
  });
}
