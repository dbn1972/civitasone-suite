import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

export function registerComplianceConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.pendingRegisterCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; paraId: string; deptRef: string;
      amountInvolvedMinor: number; dueDate?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPendingRegister(tx, {
        id: p.id, tenantId: p.tenantId, paraId: p.paraId, deptRef: p.deptRef,
        amountInvolvedMinor: BigInt(p.amountInvolvedMinor), status: "pending",
        dueDate: p.dueDate ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "pending_register", "pending"));
  });
}
