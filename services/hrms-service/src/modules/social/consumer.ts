import { pino } from "pino";
import { sql } from "drizzle-orm";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

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
    await cache.invalidateResource(msg.tenantId, "social");
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
    await cache.invalidateResource(msg.tenantId, "social");
    log.info({ id: msg.messageId, announcementId: p.id }, "Processed social.announcement_create");
  });

  // Travel-request create (command path). ONE transaction: markProcessed + guarded
  // insert (ON CONFLICT (id) DO NOTHING -> a replay of the same id is a no-op, with
  // no second audit/notification) + domain event + audit + approval notification.
  queue.subscribe(COMMANDS.travelRequestCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeId: string;
      purpose: string; destination: string; fromDate: string; toDate: string;
      advanceRequired?: number; mode?: string; managerId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inserted = await tx.execute(sql`
        INSERT INTO claims.hrms_travel_requests
          (id, tenant_id, employee_id, purpose, destination, from_date, to_date, advance_required, mode, status, created_at, updated_at)
        VALUES (${p.id}, ${msg.tenantId}, ${p.employeeId}, ${p.purpose}, ${p.destination}, ${p.fromDate}, ${p.toDate},
                ${p.advanceRequired ?? 0}, ${p.mode ?? "rail"}, 'pending', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
        RETURNING id`);
      if (inserted.length === 0) return; // this travel request id already exists: first write stands
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
        payload: {
          service: "hrms", action: "travel_request_create", resourceType: "travel_request", resourceId: p.id, outcome: "success",
          metadata: { destination: p.destination, fromDate: p.fromDate, toDate: p.toDate, advanceRequired: p.advanceRequired ?? 0, mode: p.mode ?? "rail" },
        },
      });
      if (p.managerId) {
        await enqueue(tx, {
          topic: "notification.send", eventType: "hrms.travel.requested",
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            templateId: "00000000-0000-4000-8001-000000000000",
            recipient: p.managerId, recipientId: p.managerId,
            channel: "push", eventType: "hrms.travel.requested",
            variables: { destination: p.destination, fromDate: p.fromDate, toDate: p.toDate },
          },
        });
      }
    });
    await cache.invalidateResource(msg.tenantId, "social");
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
    await cache.invalidateResource(msg.tenantId, "social");
    log.info({ id: msg.messageId, travelId: p.id }, "Processed social.travel_request_approve");
  });

  // Expense-claim create (command path). Same single-transaction shape as above.
  // The linked travel request (if any) is re-asserted ATOMICALLY with the insert:
  // it must be the claimant's own, in this tenant (the FK alone is tenant-blind).
  queue.subscribe(COMMANDS.expenseCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeId: string;
      category: string; amount: number; description?: string; date: string;
      receiptKey?: string | null; travelRequestId?: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const travelId = p.travelRequestId ?? null;
      const inserted = await tx.execute(sql`
        INSERT INTO claims.hrms_expense_claims
          (id, tenant_id, employee_id, category, amount, description, expense_date, receipt_key, travel_request_id, status, created_at, updated_at)
        SELECT ${p.id}::uuid, ${msg.tenantId}::uuid, ${p.employeeId}::uuid, ${p.category}, ${p.amount}, ${p.description ?? ""},
               ${p.date}::date, ${p.receiptKey ?? null}, ${travelId}::uuid, 'pending', NOW(), NOW()
        WHERE ${travelId}::uuid IS NULL OR EXISTS (
          SELECT 1 FROM claims.hrms_travel_requests t
          WHERE t.id = ${travelId}::uuid AND t.tenant_id = ${msg.tenantId}::uuid AND t.employee_id = ${p.employeeId}::uuid)
        ON CONFLICT (id) DO NOTHING
        RETURNING id`);
      if (inserted.length === 0) {
        const existing = await tx.execute(sql`
          SELECT 1 FROM claims.hrms_expense_claims WHERE id = ${p.id}::uuid AND tenant_id = ${msg.tenantId}::uuid`);
        if (existing.length > 0) return; // replay of an already-created claim: first write stands
        throw new NonRetryableError(`expense claim ${p.id}: linked travel request ${travelId} not found for this claimant`);
      }
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
        payload: {
          service: "hrms", action: "expense_create", resourceType: "expense_claim", resourceId: p.id, outcome: "success",
          metadata: { category: p.category, amount: p.amount, travelRequestId: travelId },
        },
      });
    });
    await cache.invalidateResource(msg.tenantId, "social");
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
    await cache.invalidateResource(msg.tenantId, "social");
    log.info({ id: msg.messageId, expenseId: p.id }, "Processed social.expense_approve");
  });
}
