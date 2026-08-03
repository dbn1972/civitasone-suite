import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { and, eq } from "drizzle-orm";
import { hrmsServiceBookEntries } from "../service-book/schema.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";

const log = pino({ name: "lifecycle-consumer" });
const AUDIT = "audit.event.record";

export function registerLifecycleConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.lifecycleConfirm, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      confirmationDate: string;
      orderRef?: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Update employee status to confirmed, set confirmationDate
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "confirm",
          resourceType: "employee",
          resourceId: p.employeeId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
    log.info({ messageId: msg.messageId }, "employee confirmation processed");
  });

  queue.subscribe(COMMANDS.lifecycleSeparate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      separationType: string;
      effectiveDate: string;
      orderRef?: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Update employee status to separated, record separation details
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "separate",
          resourceType: "employee",
          resourceId: p.employeeId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
    log.info({ messageId: msg.messageId }, "employee separation processed");
  });

  queue.subscribe(COMMANDS.lifecycleReinstate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      reinstatementDate: string;
      orderRef?: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Update employee status back to active, clear separation fields
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "reinstate",
          resourceType: "employee",
          resourceId: p.employeeId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
    log.info({ messageId: msg.messageId }, "employee reinstatement processed");
  });

  log.info("lifecycle consumers registered");
}

export function registerLifecycleMutationConsumers(q: Queue): void {
  q.subscribe(COMMANDS.lifecyclePromotionCreate, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPromotion(tx, {
        id: p.id, tenantId: p.tenantId, createdBy: msg.actorId, updatedBy: msg.actorId,
        employeeId: p.employeeId, fromDesigId: p.fromDesigId, toDesigId: p.toDesigId,
        effectiveDate: p.effectiveDate, orderRef: p.orderRef ?? null,
        newBasicMinor: p.newBasicMinor !== undefined && p.newBasicMinor !== null ? BigInt(p.newBasicMinor) : null,
      });
      const promoSet: Record<string, unknown> = { designationId: p.toDesigId, updatedBy: msg.actorId };
      if (p.newBasicMinor !== undefined && p.newBasicMinor !== null) promoSet.basicMinor = BigInt(p.newBasicMinor);
      await tx.update(hrmsEmployees).set(promoSet)
        .where(and(eq(hrmsEmployees.id, p.employeeId), eq(hrmsEmployees.tenantId, p.tenantId)));
      await tx.insert(hrmsServiceBookEntries).values({
        tenantId: p.tenantId, employeeId: p.employeeId, entryType: "promotion",
        effectiveDate: p.effectiveDate,
        description: `Promotion to designation ${p.toDesigId}`,
        recordedBy: msg.actorId, documentRef: p.orderRef ?? null,
      });
      await enqueue(tx as any, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "lifecycle_promotion", resourceType: "promotion", resourceId: p.id, outcome: "success" },
      });
    });
  });

  q.subscribe(COMMANDS.lifecycleTransferCreate, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertTransfer(tx, {
        id: p.id, tenantId: p.tenantId, createdBy: msg.actorId, updatedBy: msg.actorId,
        employeeId: p.employeeId, fromDeptId: p.fromDeptId, toDeptId: p.toDeptId,
        fromDesigId: p.fromDesigId ?? null, toDesigId: p.toDesigId ?? null,
        effectiveDate: p.effectiveDate, orderRef: p.orderRef ?? null,
        fromStation: p.fromStation ?? null, toStation: p.toStation ?? null, status: "requested",
      });
    });
  });

  q.subscribe(COMMANDS.lifecycleTransferIssue, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.transitionTransfer(p.tenantId, p.id, msg.actorId, {
        from: ["requested", "pending"], to: "ordered",
        set: { orderNo: p.orderNo, orderDate: p.orderDate, orderRef: p.orderRef ?? null },
      }, tx);
    });
  });

  q.subscribe(COMMANDS.lifecycleTransferRelieve, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.transitionTransfer(p.tenantId, p.id, msg.actorId, {
        from: ["ordered"], to: "relieved", set: { relievedDate: p.relievedDate },
      }, tx);
    });
  });

  q.subscribe(COMMANDS.lifecycleTransferJoin, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.transitionTransfer(p.tenantId, p.id, msg.actorId, {
        from: ["relieved"], to: "joined", set: { joinedDate: p.joinedDate },
      }, tx);
      if (!row) return;
      const masterSet: Record<string, unknown> = { departmentId: row.toDeptId, updatedBy: msg.actorId };
      if (row.toDesigId) masterSet.designationId = row.toDesigId;
      if (row.toStation) masterSet.station = row.toStation;
      await tx.update(hrmsEmployees).set(masterSet).where(eq(hrmsEmployees.id, row.employeeId));
      await tx.insert(hrmsServiceBookEntries).values({
        tenantId: p.tenantId, employeeId: row.employeeId, entryType: "transfer",
        effectiveDate: p.joinedDate,
        description: `Transferred and joined at ${row.toStation ?? "new station"} (dept ${row.toDeptId})`,
        recordedBy: msg.actorId, documentRef: row.orderNo ?? row.orderRef ?? null,
      });
    });
  });
}
