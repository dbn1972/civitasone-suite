import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.social.consumer" });
const AUDIT = "audit.event.record";

export function registerSocialConsumers(queue: Queue): void {
  queue.subscribe("hrms.social.kudos_create", async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      giverId: string; receiverId: string;
      badge: string; message: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.social.kudos_created",
        eventType: "hrms.social.kudos_created",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, giverId: p.giverId, receiverId: p.receiverId, badge: p.badge },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "kudos_create", resourceType: "kudos", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:social:*`);
    log.info({ id: msg.messageId, kudosId: p.id }, "Processed social.kudos_create");
  });

  queue.subscribe("hrms.social.announcement_create", async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      title: string; category: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.social.announcement_created",
        eventType: "hrms.social.announcement_created",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, title: p.title, category: p.category },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "announcement_create", resourceType: "announcement", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:social:*`);
    log.info({ id: msg.messageId, announcementId: p.id }, "Processed social.announcement_create");
  });

  queue.subscribe("hrms.social.travel_request_create", async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeId: string;
      destination: string; fromDate: string; toDate: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.social.travel_request_created",
        eventType: "hrms.social.travel_request_created",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, employeeId: p.employeeId, destination: p.destination },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "travel_request_create", resourceType: "travel_request", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:social:*`);
    log.info({ id: msg.messageId, travelId: p.id }, "Processed social.travel_request_create");
  });

  queue.subscribe("hrms.social.travel_request_approve", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.social.travel_request_approved",
        eventType: "hrms.social.travel_request_approved",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "travel_request_approve", resourceType: "travel_request", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:social:*`);
    log.info({ id: msg.messageId, travelId: p.id }, "Processed social.travel_request_approve");
  });

  queue.subscribe("hrms.social.expense_create", async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeId: string;
      category: string; amount: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.social.expense_created",
        eventType: "hrms.social.expense_created",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, employeeId: p.employeeId, category: p.category, amount: p.amount },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "expense_create", resourceType: "expense_claim", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:social:*`);
    log.info({ id: msg.messageId, expenseId: p.id }, "Processed social.expense_create");
  });

  queue.subscribe("hrms.social.expense_approve", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.social.expense_approved",
        eventType: "hrms.social.expense_approved",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "expense_approve", resourceType: "expense_claim", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:social:*`);
    log.info({ id: msg.messageId, expenseId: p.id }, "Processed social.expense_approve");
  });
}
