/**
 * TKT-11: Saved Views — command consumer.
 *
 * views-routes.ts publishes VIEW_COMMANDS.{create,update,delete} but (before
 * this file) nothing subscribed: the routes returned 202 and the saved view
 * was never persisted (GET always read real rows via scopedRead, but nothing
 * ever wrote one). Mirrors the tickets/consumer.ts pattern: tenantScoped queue,
 * db.transaction + markProcessed for idempotency, outbox event + audit emit.
 */
import type { Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { VIEW_COMMANDS, EVENTS } from "../../topics.js";
import { savedViews, type SavedViewRow } from "./views-schema.js";

const AUDIT_TOPIC = "audit.event.record";

/** Roles allowed to modify/delete a view they don't own (mirrors the
 * HELPDESK_ADMIN_ROLES pattern used for internal notes / transfers). */
const VIEW_ADMIN_ROLES = ["helpdesk_admin", "super_admin"];

function isViewAdmin(roles: string[] | undefined): boolean {
  return (roles ?? []).some((r) => VIEW_ADMIN_ROLES.includes(r));
}

type CreateViewPayload = {
  id: string;
  tenantId: string;
  ownerId: string;
  name: string;
  filters: Record<string, unknown>;
  columns: string[];
  shared: boolean;
};

type UpdateViewPayload = {
  id: string;
  tenantId: string;
  actorId: string;
  actorRoles?: string[];
  name?: string;
  filters?: Record<string, unknown>;
  columns?: string[];
  shared?: boolean;
  isDefault?: boolean;
};

type DeleteViewPayload = {
  id: string;
  tenantId: string;
  actorId: string;
  actorRoles?: string[];
};

type Writer = Pick<typeof db, "insert" | "update" | "delete" | "select">;

async function findViewTx(tx: Writer, id: string, tenantId: string): Promise<SavedViewRow | null> {
  const rows = await (tx as typeof db).select().from(savedViews)
    .where(and(eq(savedViews.id, id), eq(savedViews.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export function registerViewConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  // ---- create -------------------------------------------------------------
  // Idempotent on `id` (the route mints the view id and reuses it as the
  // command's messageId, mirroring the ticket-notes/links pattern) —
  // onConflictDoNothing is the DB-level backstop under markProcessed.
  queue.subscribe<CreateViewPayload>(VIEW_COMMANDS.create, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const res = await (tx as typeof db).insert(savedViews).values({
        id: p.id,
        tenantId: p.tenantId,
        ownerId: p.ownerId,
        name: p.name,
        filters: p.filters,
        columns: p.columns,
        shared: p.shared,
      }).onConflictDoNothing().returning();
      if (res.length === 0) return; // duplicate delivery of the same view id
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.viewCreated, eventType: EVENTS.viewCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { viewId: p.id, name: p.name, shared: p.shared },
      });
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "helpdesk", action: "view_create", resourceType: "saved_view", resourceId: p.id, outcome: "success" },
      });
    });
  });

  // ---- update ---------------------------------------------------------------
  // Tenant-scoped, partial-field update; bumps version. No-op (audited
  // rejection) if the view doesn't exist in this tenant, OR if the actor
  // neither owns the view nor holds a VIEW_ADMIN_ROLES role — a private
  // (shared=false) view belonging to another tenant member must not be
  // editable just because both are in the same tenant.
  queue.subscribe<UpdateViewPayload>(VIEW_COMMANDS.update, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await findViewTx(tx, p.id, p.tenantId);
      if (!existing) {
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "helpdesk", action: "view_update", resourceType: "saved_view", resourceId: p.id, outcome: "rejected_not_found" },
        });
        return;
      }
      const isAdmin = isViewAdmin(p.actorRoles);
      if (existing.ownerId !== p.actorId && !isAdmin) {
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "helpdesk", action: "view_update", resourceType: "saved_view", resourceId: p.id, outcome: "rejected_forbidden" },
        });
        return;
      }
      const patch: Partial<typeof savedViews.$inferInsert> = { version: existing.version + 1 };
      if (p.name !== undefined) patch.name = p.name;
      if (p.filters !== undefined) patch.filters = p.filters;
      if (p.columns !== undefined) patch.columns = p.columns;
      if (p.shared !== undefined) patch.shared = p.shared;
      if (p.isDefault !== undefined) patch.isDefault = p.isDefault;
      // Defense-in-depth: re-assert the ownership guard in the UPDATE's own
      // WHERE clause (not just the app-level check above) so a race between
      // the read and this write can't slip through — a non-owner/non-admin
      // update affects 0 rows here even if `existing` were somehow stale.
      const ownerGuard = isAdmin ? [] : [eq(savedViews.ownerId, p.actorId)];
      await (tx as typeof db).update(savedViews)
        .set(patch)
        .where(and(eq(savedViews.id, p.id), eq(savedViews.tenantId, p.tenantId), ...ownerGuard));
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.viewUpdated, eventType: EVENTS.viewUpdated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { viewId: p.id, changedFields: Object.keys(patch).filter((k) => k !== "version") },
      });
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "helpdesk", action: "view_update", resourceType: "saved_view", resourceId: p.id, outcome: "success" },
      });
    });
  });

  // ---- delete ---------------------------------------------------------------
  // Same ownership guard as update: only the owner or a VIEW_ADMIN_ROLES actor
  // may delete a view. The guard is applied directly in the DELETE's WHERE
  // clause (not a separate check-then-delete) so there's no TOCTOU window;
  // a 0-row result is then disambiguated into NOT_FOUND vs FORBIDDEN for the
  // audit trail (never a silent success either way).
  queue.subscribe<DeleteViewPayload>(VIEW_COMMANDS.delete, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const isAdmin = isViewAdmin(p.actorRoles);
      const ownerGuard = isAdmin ? [] : [eq(savedViews.ownerId, p.actorId)];
      const res = await (tx as typeof db).delete(savedViews)
        .where(and(eq(savedViews.id, p.id), eq(savedViews.tenantId, p.tenantId), ...ownerGuard))
        .returning({ id: savedViews.id });
      if (res.length === 0) {
        const existing = await findViewTx(tx, p.id, p.tenantId);
        const outcome = existing ? "rejected_forbidden" : "rejected_not_found";
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "helpdesk", action: "view_delete", resourceType: "saved_view", resourceId: p.id, outcome },
        });
        return;
      }
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.viewDeleted, eventType: EVENTS.viewDeleted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { viewId: p.id },
      });
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "helpdesk", action: "view_delete", resourceType: "saved_view", resourceId: p.id, outcome: "success" },
      });
    });
  });
}
