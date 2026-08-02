import type { Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { users } from "../users/schema.js";

const AUDIT = "audit.event.record";

export function registerScimConsumers(q: Queue): void {
  q.subscribe<{ id: string; tenantId: string; email: string; name: string; status: string }>(
    COMMANDS.scimUserCreate,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await tx.insert(users).values({
          id: p.id,
          tenantId: p.tenantId,
          email: p.email,
          name: p.name,
          status: p.status,
          createdBy: "scim",
          updatedBy: "scim",
        });
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.userCreated,
          eventType: EVENTS.userCreated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { userId: p.id },
        });
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT,
          eventType: AUDIT,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "identity",
            action: "scim_user_create",
            resourceType: "user",
            resourceId: p.id,
            outcome: "success",
          },
        });
      });
    },
  );

  q.subscribe<{ id: string; tenantId: string; patch: Record<string, unknown> }>(
    COMMANDS.scimUserReplace,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await tx
          .update(users)
          .set({ ...p.patch, updatedBy: "scim", updatedAt: new Date() })
          .where(and(eq(users.id, p.id), eq(users.tenantId, p.tenantId)));
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.userUpdated,
          eventType: EVENTS.userUpdated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { userId: p.id },
        });
      });
    },
  );

  q.subscribe<{ id: string; tenantId: string; patch: Record<string, unknown> }>(
    COMMANDS.scimUserPatch,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await tx
          .update(users)
          .set({ ...p.patch, updatedBy: "scim", updatedAt: new Date() })
          .where(and(eq(users.id, p.id), eq(users.tenantId, p.tenantId)));
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.userUpdated,
          eventType: EVENTS.userUpdated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { userId: p.id },
        });
      });
    },
  );

  q.subscribe<{ id: string; tenantId: string }>(COMMANDS.scimUserDelete, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await tx
        .update(users)
        .set({ status: "disabled", updatedBy: "scim", updatedAt: new Date() })
        .where(and(eq(users.id, p.id), eq(users.tenantId, p.tenantId)));
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.userDeactivated,
        eventType: EVENTS.userDeactivated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { userId: p.id, status: "disabled" },
      });
    });
  });
}
