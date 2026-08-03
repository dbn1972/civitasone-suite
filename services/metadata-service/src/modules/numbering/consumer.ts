import type { Queue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { withTenant } from "../../shared/scope.js";
import { COMMANDS } from "../../topics.js";
import { numberFormats } from "./schema.js";

export function registerNumberingConsumers(q: Queue): void {
  q.subscribe(COMMANDS.NUMBER_FORMAT_CREATE, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(numberFormats).values({
        id: p.id, tenantId: p.tenantId, formatKey: p.formatKey, label: p.label,
        prefix: p.prefix, embedFinancialYear: p.embedFinancialYear, fyStartMonth: p.fyStartMonth,
        counterWidth: p.counterWidth, separator: p.separator, resetPolicy: p.resetPolicy,
        status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "create_number_format", resourceType: "number_format", resourceId: p.id, outcome: "success" },
      });
    });
  });

  q.subscribe(COMMANDS.NUMBER_FORMAT_UPDATE, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: msg.actorId };
      for (const k of ["label", "prefix", "embedFinancialYear", "fyStartMonth", "counterWidth", "separator", "resetPolicy"]) {
        if (p[k] !== undefined) set[k] = p[k];
      }
      await tx.update(numberFormats).set(set)
        .where(and(eq(numberFormats.id, p.id), eq(numberFormats.tenantId, p.tenantId)));
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "update_number_format", resourceType: "number_format", resourceId: p.id, outcome: "success" },
      });
    });
  });

  q.subscribe(COMMANDS.NUMBER_FORMAT_PUBLISH, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.update(numberFormats)
        .set({ status: "active", publishedAt: new Date(), publishedBy: msg.actorId, updatedAt: new Date(), updatedBy: msg.actorId })
        .where(and(eq(numberFormats.id, p.id), eq(numberFormats.tenantId, p.tenantId)));
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "publish_number_format", resourceType: "number_format", resourceId: p.id, outcome: "success" },
      });
    });
  });
}
