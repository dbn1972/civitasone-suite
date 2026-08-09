import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertCanDispose } from "./domain.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerCaseConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.caseCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; caseNo: string; title: string; court: string;
      subject?: string; caseTypeId?: string; petitioner?: string; counselRef?: string;
      parties?: Array<{ name: string; role?: string }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCase(tx, {
        id: p.id, tenantId: p.tenantId, caseNo: p.caseNo, title: p.title, court: p.court,
        subject: p.subject ?? null, caseTypeId: p.caseTypeId ?? null,
        petitioner: p.petitioner ?? null, counselRef: p.counselRef ?? null,
        status: "pending", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (p.parties?.length) {
        for (const party of p.parties) {
          await repo.insertParty(tx, {
            id: randomUUID(), tenantId: p.tenantId, caseId: p.id,
            name: party.name, role: party.role ?? "respondent",
            createdBy: msg.actorId, updatedBy: msg.actorId,
          });
        }
      }
      await audit(tx, msg, "create", "case", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "case", p.id));
  });

  queue.subscribe(COMMANDS.caseDispose, async (msg) => {
    const p = msg.payload as { caseId: string; tenantId: string; disposition: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const legalCase = await repo.findCaseByIdTx(tx, p.caseId);
      if (!legalCase) throw new Error(`case ${p.caseId} not found`);
      assertCanDispose(legalCase.status ?? "pending");
      await repo.updateCase(tx, p.caseId, {
        status: "disposed", updatedBy: msg.actorId, version: (legalCase.version ?? 1) + 1,
      });
      await audit(tx, msg, "dispose", "case", p.caseId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "case", p.caseId));
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType, resourceId, outcome: "success" },
  });
}
