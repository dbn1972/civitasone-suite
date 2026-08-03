import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

export function registerDeviceConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.deviceUpsert, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; userId: string; platform: string;
      label?: string; fingerprint: string; trustToken: string; trustLevel: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.upsertDevice(tx, {
        id: p.id,
        tenantId: p.tenantId,
        userId: p.userId,
        platform: p.platform,
        label: p.label ?? p.platform,
        fingerprint: p.fingerprint,
        trustToken: p.trustToken,
        trustLevel: p.trustLevel,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "identity", action: "upsert_device", resourceType: "device", resourceId: p.id, outcome: "success" },
      });
    });
  });
}
