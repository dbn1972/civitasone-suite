import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

export function registerSandboxTestConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.sandboxTestRecord, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      serviceDefinitionId: string;
      status: string;
      steps: unknown[];
      durationMs: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRun(tx, {
        id: p.id,
        tenantId: p.tenantId,
        serviceDefinitionId: p.serviceDefinitionId,
        status: p.status,
        steps: p.steps as never,
        durationMs: p.durationMs,
        createdBy: msg.actorId,
      });
    });
  });
}
