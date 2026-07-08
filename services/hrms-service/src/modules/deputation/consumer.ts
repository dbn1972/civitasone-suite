import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "deputation-consumer" });
const AUDIT = "audit.event.record";

export function registerDeputationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.deputationCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      parentCadre: string;
      parentDepartmentId: string;
      parentManagerId?: string;
      borrowingDepartment: string;
      borrowingDepartmentId?: string;
      borrowingManagerId?: string;
      deputationAllowanceMinor: number;
      tenureFrom: string;
      tenureTo: string;
      orderRef?: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await repo.insertDeputation(tx, {
        id: p.id,
        tenantId: p.tenantId,
        employeeId: p.employeeId,
        parentCadre: p.parentCadre,
        parentDepartmentId: p.parentDepartmentId,
        ...(p.parentManagerId ? { parentManagerId: p.parentManagerId } : {}),
        borrowingDepartment: p.borrowingDepartment,
        ...(p.borrowingDepartmentId ? { borrowingDepartmentId: p.borrowingDepartmentId } : {}),
        ...(p.borrowingManagerId ? { borrowingManagerId: p.borrowingManagerId } : {}),
        deputationAllowanceMinor: BigInt(p.deputationAllowanceMinor),
        tenureFrom: p.tenureFrom,
        tenureTo: p.tenureTo,
        status: "active",
        ...(p.orderRef ? { orderRef: p.orderRef } : {}),
        ...(p.remarks ? { remarks: p.remarks } : {}),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "create",
          resourceType: "deputation",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "deputation", p.id));
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
    log.info({ messageId: msg.messageId }, "deputation created processed");
  });

  queue.subscribe(COMMANDS.deputationExtend, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      deputationId: string;
      newTenureTo: string;
      orderRef?: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await repo.closeDeputation(tx, msg.tenantId, p.deputationId, {
        tenureTo: p.newTenureTo,
        ...(p.orderRef ? { orderRef: p.orderRef } : {}),
        ...(p.remarks ? { remarks: p.remarks } : {}),
        updatedBy: msg.actorId,
      }, (await repo.findById(msg.tenantId, p.deputationId))?.version ?? 1);

      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "extend",
          resourceType: "deputation",
          resourceId: p.deputationId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "deputation", p.deputationId));
    log.info({ messageId: msg.messageId }, "deputation extension processed");
  });

  queue.subscribe(COMMANDS.deputationRevert, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      deputationId: string;
      employeeId: string;
      repatriatedOn: string;
      note?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const dep = await repo.findById(msg.tenantId, p.deputationId);
      const version = dep?.version ?? 1;

      await repo.closeDeputation(tx, msg.tenantId, p.deputationId, {
        status: "repatriated",
        repatriatedOn: p.repatriatedOn,
        ...(p.note ? { repatriationNote: p.note } : {}),
        updatedBy: msg.actorId,
      }, version);

      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "revert",
          resourceType: "deputation",
          resourceId: p.deputationId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "deputation", p.deputationId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
    log.info({ messageId: msg.messageId }, "deputation revert processed");
  });

  log.info("deputation consumers registered");
}
