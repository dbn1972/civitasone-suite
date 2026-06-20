import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

export function registerPortalConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.profileCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string;
      email?: string; mobile?: string; digilockerToken?: string; address?: string; ward?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertProfile(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name,
        email: p.email ?? null, mobile: p.mobile ?? null,
        digilockerToken: p.digilockerToken ?? null,
        address: p.address ?? null, ward: p.ward ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "citizen_profile", p.id);
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType, resourceId, outcome: "success" },
  });
}
