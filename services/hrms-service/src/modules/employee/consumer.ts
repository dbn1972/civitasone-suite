import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as lifecycleRepo from "../lifecycle/repo.js";

const AUDIT = "audit.event.record";

export function registerEmployeeConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.employeeCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeNo: string; fullName: string;
      departmentId: string; designationId: string; dateOfJoining: string;
      employeeType: string; basicMinor: number; currency: string;
      dateOfBirth?: string; gender?: string; pan?: string; aadhaarRef?: string;
      mobile?: string; email?: string; bankAccountNo?: string; bankIfsc?: string;
      payStructureId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertEmployee(tx, {
        id: p.id, tenantId: p.tenantId, employeeNo: p.employeeNo, fullName: p.fullName,
        departmentId: p.departmentId, designationId: p.designationId,
        dateOfJoining: p.dateOfJoining, employeeType: p.employeeType as "permanent",
        basicMinor: BigInt(p.basicMinor), currency: p.currency as "INR", status: "probation",
        dateOfBirth: p.dateOfBirth ?? null, gender: p.gender ?? null, pan: p.pan ?? null,
        aadhaarRef: p.aadhaarRef ?? null, mobile: p.mobile ?? null, email: p.email ?? null,
        bankAccountNo: p.bankAccountNo ?? null, bankIfsc: p.bankIfsc ?? null,
        payStructureId: p.payStructureId ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.employeeCreated, eventType: EVENTS.employeeCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { employeeId: p.id, employeeNo: p.employeeNo, tenantId: p.tenantId },
      });
      await audit(tx, msg, "create", "employee", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.id));
  });

  queue.subscribe(COMMANDS.employeeConfirm, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; confirmationDate: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateEmployee(tx, p.id, { status: "confirmed", confirmationDate: p.confirmationDate, updatedBy: msg.actorId });
      await audit(tx, msg, "confirm", "employee", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.id));
  });

  queue.subscribe(COMMANDS.employeeTransfer, async (msg) => {
    const p = msg.payload as {
      employeeId: string; tenantId: string; fromDeptId: string; toDeptId: string;
      fromDesigId?: string; toDesigId?: string; effectiveDate: string; orderRef?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lifecycleRepo.insertTransfer(tx, {
        id: msg.messageId, tenantId: p.tenantId, employeeId: p.employeeId,
        fromDeptId: p.fromDeptId, toDeptId: p.toDeptId,
        fromDesigId: p.fromDesigId ?? null, toDesigId: p.toDesigId ?? null,
        effectiveDate: p.effectiveDate, orderRef: p.orderRef ?? null, status: "completed",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const patch: Parameters<typeof repo.updateEmployee>[2] = {
        departmentId: p.toDeptId, status: "transferred", updatedBy: msg.actorId,
      };
      if (p.toDesigId) patch.designationId = p.toDesigId;
      await repo.updateEmployee(tx, p.employeeId, patch);
      await audit(tx, msg, "transfer", "employee", p.employeeId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
  });

  queue.subscribe(COMMANDS.employeeSeparate, async (msg) => {
    const p = msg.payload as {
      employeeId: string; tenantId: string; separationType: string;
      effectiveDate: string; lastWorkingDate?: string; encashmentDays: number; remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lifecycleRepo.insertSeparation(tx, {
        id: msg.messageId, tenantId: p.tenantId, employeeId: p.employeeId,
        separationType: p.separationType, effectiveDate: p.effectiveDate,
        lastWorkingDate: p.lastWorkingDate ?? null, encashmentDays: p.encashmentDays,
        encashmentMinor: 0n, gratuityMinor: 0n,
        remarks: p.remarks ?? null, status: "initiated",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateEmployee(tx, p.employeeId, { status: "separated", updatedBy: msg.actorId });
      await audit(tx, msg, "separate", "employee", p.employeeId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType, resourceId, outcome: "success" },
  });
}
