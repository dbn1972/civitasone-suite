import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import type { RegisterMigrationBody } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";

type RegisterPayload = RegisterMigrationBody & { id: string; tenantId: string };
type LinkPayload = { id: string; tenantId: string; efileId: string };

export function registerMigrationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.migrationRegister, async (msg) => {
    const p = msg.payload as RegisterPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertMigration(tx, {
        id: p.id, tenantId: p.tenantId, legacyFileNo: p.legacyFileNo,
        subject: p.subject, dept: p.dept, pageCount: p.pageCount,
        scanRef: p.scanRef ?? null, status: p.scanRef ? "digitised" : "registered",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "estab", action: "migration.register", resourceType: "migration", resourceId: p.id, outcome: "success", metadata: { legacyFileNo: p.legacyFileNo } },
      });
    });
  });

  queue.subscribe(COMMANDS.migrationLink, async (msg) => {
    const p = msg.payload as LinkPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findMigrationById(p.id, p.tenantId);
      if (!cur) return;
      await repo.updateMigration(tx, p.id, {
        efileId: p.efileId, status: "linked", updatedBy: msg.actorId, version: cur.version + 1,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "estab", action: "migration.link", resourceType: "migration", resourceId: p.id, outcome: "success", metadata: { efileId: p.efileId } },
      });
    });
  });
}
