/**
 * code-list consumers (CAP-017). Tenants create tenant-scoped lists/values only
 * (tenant_id = msg.tenantId; RLS WITH CHECK forbids writing globals). Supersede
 * demonstrates effective-dated versioning (CAP-018): close the current value and
 * open a new one atomically.
 */
import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";

const log = pino({ name: "code-list-consumer" });

export function registerCodeListConsumers(q: Queue): void {
  q.subscribe("tenant.code_list.create", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; code: string; name: string; description?: string };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertList(tx, { id: p.id, tenantId: p.tenantId, code: p.code, name: p.name, description: p.description ?? null, createdBy: msg.actorId });
    }));
  });

  q.subscribe("tenant.code_value.add", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; listId: string; code: string; label: string; sortOrder?: number; metadata?: Record<string, unknown> };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertValue(tx, {
        id: p.id, tenantId: p.tenantId, listId: p.listId, code: p.code, label: p.label,
        sortOrder: p.sortOrder ?? 0, metadata: p.metadata ?? {}, createdBy: msg.actorId,
      });
    }));
  });

  q.subscribe("tenant.code_value.supersede", async (msg) => {
    const p = msg.payload as { tenantId: string; listId: string; code: string; label: string; sortOrder?: number };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const current = await repo.findActiveValueTx(tx, p.tenantId, p.listId, p.code);
      if (!current) { log.warn({ listId: p.listId, code: p.code }, "supersede: no active value"); return; }
      const at = new Date();
      await repo.closeValue(tx, current.id, at);
      await repo.insertValue(tx, {
        id: randomUUID(), tenantId: p.tenantId, listId: p.listId, code: p.code, label: p.label,
        sortOrder: p.sortOrder ?? current.sortOrder, metadata: current.metadata as Record<string, unknown>,
        effectiveFrom: at, createdBy: msg.actorId,
      });
    }));
  });
}
