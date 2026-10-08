import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT = "audit.event.record";

export function registerCpioConsumers(rawQueue: Queue): void {
  // #146 NOBYPASSRLS: run inside the message's tenant context so RLS GUC is set.
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.cpioDirectoryCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; designation?: string;
      publicAuthority: string; department?: string; email?: string; phone?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCpio(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name,
        designation: p.designation ?? null, publicAuthority: p.publicAuthority,
        department: p.department ?? null, email: p.email ?? null, phone: p.phone ?? null,
        status: "active", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // Audit in the same transaction as the write (CLAUDE.md §8).
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "citizen", action: "cpio_directory_create",
          resourceType: "cpio_directory", resourceId: p.id, outcome: "success",
          newValue: { name: p.name, publicAuthority: p.publicAuthority },
        },
      });
    });
  });
}
