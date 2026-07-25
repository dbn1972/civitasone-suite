import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { cases, caseDeviations } from "./schema.js";
import { eq, and } from "drizzle-orm";

export function registerCaseRegistryConsumers(q: Queue): void {
  q.subscribe("workflow.case.create", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; caseNumber: string; title: string; caseType: string; sourceService: string; sourceRefId: string; priority?: string; metadata?: Record<string, unknown> };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(cases).values({
        id: p.id, tenantId: p.tenantId, caseNumber: p.caseNumber, title: p.title,
        caseType: p.caseType, sourceService: p.sourceService, sourceRefId: p.sourceRefId,
        priority: p.priority ?? "normal", status: "open", metadata: p.metadata ?? {},
        createdBy: msg.actorId, version: 1,
      });
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record", tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow", action: "create_case", resourceType: "case", resourceId: p.id, outcome: "success" } });
    });
  });

  q.subscribe("workflow.case.split", async (msg) => {
    const p = msg.payload as { parentCaseId: string; subCases: Array<{ id: string; title: string; caseType: string; assigneeId?: string }> };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const parent = await tx.select().from(cases).where(eq(cases.id, p.parentCaseId)).limit(1);
      if (!parent[0]) return;
      for (const sc of p.subCases) {
        await tx.insert(cases).values({
          id: sc.id, tenantId: parent[0].tenantId, caseNumber: `${parent[0].caseNumber}-${sc.id.slice(0, 4)}`,
          title: sc.title, caseType: sc.caseType, sourceService: parent[0].sourceService,
          sourceRefId: parent[0].sourceRefId, priority: parent[0].priority, status: "open",
          parentCaseId: p.parentCaseId, assigneeId: sc.assigneeId ?? null,
          metadata: {}, createdBy: msg.actorId, version: 1,
        });
      }
      await tx.update(cases).set({ status: "split", updatedAt: new Date() }).where(eq(cases.id, p.parentCaseId));
    });
  });

  q.subscribe("workflow.case.merge", async (msg) => {
    const p = msg.payload as { caseIds: string[]; targetCaseId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      for (const caseId of p.caseIds) {
        if (caseId === p.targetCaseId) continue;
        await tx.update(cases).set({ mergedIntoCaseId: p.targetCaseId, status: "merged", updatedAt: new Date() }).where(eq(cases.id, caseId));
      }
    });
  });

  q.subscribe("workflow.case.deviation", async (msg) => {
    const p = msg.payload as { id: string; caseId: string; tenantId: string; type: string; description: string; severity?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(caseDeviations).values({
        id: p.id, tenantId: p.tenantId, caseId: p.caseId,
        type: p.type, description: p.description, severity: p.severity ?? "medium",
        status: "open", createdBy: msg.actorId,
      });
    });
  });
}
