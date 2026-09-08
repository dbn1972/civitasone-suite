import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const TERMINAL_STATUSES = new Set(["resolved", "rejected", "cancelled"]);

export function registerServiceRequestConsumers(rawQueue: Queue): void {
  // #146 NOBYPASSRLS: every handler must run inside the message's tenant
  // context so wrapWithTenantGuc sets app.tenant_id (RLS) in db.transaction().
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.serviceRequestSubmit, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; citizenId: string; subject: string; description: string;
      category?: string; channel?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRequest(tx, {
        id: p.id, tenantId: p.tenantId, citizenId: p.citizenId,
        category: p.category ?? "general", subject: p.subject, description: p.description,
        channel: p.channel ?? "portal", status: "submitted",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertStatusHistory(tx, {
        tenantId: p.tenantId, requestId: p.id, fromStatus: null, toStatus: "submitted",
        note: null, createdBy: msg.actorId,
      });
      // Real outbox event so a downstream consumer (e.g. a department-routing
      // subscriber) is genuinely notified of the new request — not a fabricated
      // notification to a recipient nothing in this service can resolve.
      await enqueue(tx, {
        topic: EVENTS.serviceRequestSubmitted, eventType: EVENTS.serviceRequestSubmitted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.id, tenantId: p.tenantId, citizenId: p.citizenId, category: p.category ?? "general", subject: p.subject },
      });
      await audit(tx, msg, "create", "citizen_service_request", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "service_request", p.id));
  });

  queue.subscribe(COMMANDS.serviceRequestUpdate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; status?: string; note?: string; assigneeDepartment?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const current = await repo.findRequestByIdTx(tx, p.id, msg.tenantId);
      if (!current) return;
      // P1: state guard — a request in a terminal state cannot be transitioned
      // further; this is a no-op (no duplicate history row / audit entry).
      if (TERMINAL_STATUSES.has(current.status)) return;
      const toStatus = p.status ?? current.status;
      await repo.updateRequest(tx, p.id, msg.tenantId, {
        status: toStatus,
        assigneeDepartment: p.assigneeDepartment ?? current.assigneeDepartment,
        resolvedAt: toStatus === "resolved" ? new Date() : current.resolvedAt,
        updatedBy: msg.actorId,
      });
      if (toStatus !== current.status) {
        await repo.insertStatusHistory(tx, {
          tenantId: p.tenantId, requestId: p.id, fromStatus: current.status, toStatus,
          note: p.note ?? null, createdBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: EVENTS.serviceRequestStatusChanged, eventType: EVENTS.serviceRequestStatusChanged,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { id: p.id, tenantId: p.tenantId, fromStatus: current.status, toStatus },
        });
      }
      await audit(tx, msg, "update", "citizen_service_request", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "service_request", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType, resourceId, outcome: "success" },
  });
}
