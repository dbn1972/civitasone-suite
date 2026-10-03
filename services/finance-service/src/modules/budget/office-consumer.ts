import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { auditEvent } from "../approvals/apply.js";
import { DomainError } from "./domain.js";
import { financeOffices } from "./office-schema.js";

export function registerOfficeConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.officeCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; code: string; name: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inserted = await tx.insert(financeOffices).values({
        id: p.id, tenantId: p.tenantId, code: p.code, name: p.name, createdBy: msg.actorId, updatedBy: msg.actorId,
      }).onConflictDoNothing().returning({ id: financeOffices.id });
      if (inserted.length === 0) throw new DomainError("OFFICE_CODE_EXISTS", `office code ${p.code} already exists`);
      await auditEvent(tx, msg as never, "create_office", "office", p.id, { code: p.code, name: p.name });
    });
    await cache.invalidateResource(msg.tenantId, "offices");
  });
}
