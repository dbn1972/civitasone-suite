/**
 * Config masters (CFG-02 categories, CFG-04 status config, CFG-05 dispositions)
 * — command consumers.
 *
 * The routes used to answer 201/200 with an echoed body and publish nothing, so
 * no category/status/disposition was ever stored. Each mutation now publishes a
 * command that is applied here: markProcessed (idempotent redelivery), a
 * tenant-scoped write and an audit event, all in ONE transaction.
 */
import type { Queue } from "@civitasone/queue";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { categories } from "./categories-schema.js";
import { statusConfig } from "./statuses-schema.js";
import { dispositions } from "./dispositions-schema.js";

const AUDIT = "audit.event.record";

type Msg = { tenantId: string; actorId: string; correlationId: string };
type Tx = Parameters<typeof enqueue>[0];

async function audit(tx: Tx, msg: Msg, resourceType: string, action: string, resourceId: string, outcome = "success") {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "helpdesk", action, resourceType, resourceId, outcome },
  });
}

type CategoryCreate = { id: string; tenantId: string; name: string; parentId?: string | null; ordinal?: number; enabled?: boolean };
type CategoryUpdate = { id: string; tenantId: string; name?: string; parentId?: string | null; ordinal?: number; enabled?: boolean };
type StatusCreate = { id: string; tenantId: string; name: string; color: string; canonicalState: string; ordinal?: number };
type StatusUpdate = { id: string; tenantId: string; name?: string; color?: string; canonicalState?: string; ordinal?: number };
type DispositionCreate = { id: string; tenantId: string; label: string; category?: string | null; enabled?: boolean };

async function categoryExists(tx: Tx, tenantId: string, id: string): Promise<boolean> {
  const rows = await (tx as unknown as typeof db).select({ id: categories.id }).from(categories)
    .where(and(eq(categories.id, id), eq(categories.tenantId, tenantId))).limit(1);
  return rows.length > 0;
}

export function registerConfigConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  // ---- CFG-02 categories ---------------------------------------------------
  queue.subscribe<CategoryCreate>(COMMANDS.configCategoryCreate, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // parent_id is an FK: a parent that is not in this tenant would throw and
      // poison the message, so reject it as an audited no-op instead.
      if (p.parentId && !(await categoryExists(tx as Tx, msg.tenantId, p.parentId))) {
        await audit(tx as Tx, msg, "category", "category_create", p.id, "rejected_parent_not_found");
        return;
      }
      await tx.insert(categories).values({
        id: p.id,
        tenantId: msg.tenantId,
        name: p.name,
        parentId: p.parentId ?? null,
        ordinal: p.ordinal ?? 0,
        enabled: p.enabled ?? true,
      }).onConflictDoNothing();
      await audit(tx as Tx, msg, "category", "category_create", p.id);
    });
  });

  queue.subscribe<CategoryUpdate>(COMMANDS.configCategoryUpdate, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (p.parentId) {
        // A category cannot be its own parent, and the parent must exist.
        if (p.parentId === p.id || !(await categoryExists(tx as Tx, msg.tenantId, p.parentId))) {
          await audit(tx as Tx, msg, "category", "category_update", p.id, "rejected_invalid_parent");
          return;
        }
      }
      const set: Record<string, unknown> = { updatedAt: new Date(), version: sql`${categories.version} + 1` };
      if (p.name !== undefined) set.name = p.name;
      if (p.parentId !== undefined) set.parentId = p.parentId;
      if (p.ordinal !== undefined) set.ordinal = p.ordinal;
      if (p.enabled !== undefined) set.enabled = p.enabled;
      const res = await tx.update(categories).set(set)
        .where(and(eq(categories.id, p.id), eq(categories.tenantId, msg.tenantId)))
        .returning({ id: categories.id });
      await audit(tx as Tx, msg, "category", "category_update", p.id, res.length > 0 ? "success" : "rejected_not_found");
    });
  });

  // ---- CFG-04 status config ------------------------------------------------
  queue.subscribe<StatusCreate>(COMMANDS.configStatusCreate, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(statusConfig).values({
        id: p.id,
        tenantId: msg.tenantId,
        name: p.name,
        color: p.color,
        canonicalState: p.canonicalState,
        ordinal: p.ordinal ?? 0,
      }).onConflictDoNothing();
      await audit(tx as Tx, msg, "status_config", "status_create", p.id);
    });
  });

  queue.subscribe<StatusUpdate>(COMMANDS.configStatusUpdate, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const set: Record<string, unknown> = { version: sql`${statusConfig.version} + 1` };
      if (p.name !== undefined) set.name = p.name;
      if (p.color !== undefined) set.color = p.color;
      if (p.canonicalState !== undefined) set.canonicalState = p.canonicalState;
      if (p.ordinal !== undefined) set.ordinal = p.ordinal;
      const res = await tx.update(statusConfig).set(set)
        .where(and(eq(statusConfig.id, p.id), eq(statusConfig.tenantId, msg.tenantId)))
        .returning({ id: statusConfig.id });
      await audit(tx as Tx, msg, "status_config", "status_update", p.id, res.length > 0 ? "success" : "rejected_not_found");
    });
  });

  // ---- CFG-05 dispositions -------------------------------------------------
  queue.subscribe<DispositionCreate>(COMMANDS.configDispositionCreate, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(dispositions).values({
        id: p.id,
        tenantId: msg.tenantId,
        label: p.label,
        category: p.category ?? null,
        enabled: p.enabled ?? true,
      }).onConflictDoNothing();
      await audit(tx as Tx, msg, "disposition", "disposition_create", p.id);
    });
  });
}
