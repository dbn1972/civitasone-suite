import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { NonRetryableError } from "@civitasone/queue";
import { payTermsColumns, mergedTermsError, moneyChanges, patchDiff, type PayTermsPatch } from "./pay-terms.js";
import { liveProfileReferencesDeputation } from "../pay-profile/repo.js";

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
      }, (await repo.findByIdTx(tx, msg.tenantId, p.deputationId))?.version ?? 1);

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

      const dep = await repo.findByIdTx(tx, msg.tenantId, p.deputationId);
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

  // PAY-PROFILES: deputation-order pay terms. Versioned against the row the
  // route validated, so an edit made in between is not silently overwritten.
  queue.subscribe(COMMANDS.deputationPayTermsUpdate, async (msg) => {
    const p = msg.payload as { deputationId: string; expectedVersion: number; terms: PayTermsPatch };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const dep = await repo.findByIdTx(tx, msg.tenantId, p.deputationId);
      if (!dep) throw new NonRetryableError(`deputation ${p.deputationId} not found`);
      if (dep.status !== "active") throw new NonRetryableError(`deputation ${p.deputationId} is ${dep.status}`);
      const cols = payTermsColumns(p.terms);
      const termsError = mergedTermsError(dep, cols);
      if (termsError) throw new NonRetryableError(termsError);
      // Re-assert the profile lock at write time (a profile may have been
      // requested/approved since the route accepted this edit).
      const money = moneyChanges(dep, cols);
      if (money.fields.length > 0 && await liveProfileReferencesDeputation(tx, msg.tenantId, p.deputationId)) {
        throw new NonRetryableError(`PAY_TERMS_LOCKED_BY_PROFILE: ${money.fields.join(", ")} are fixed by an active or pending pay profile`);
      }
      const diff = patchDiff(dep, cols);
      await repo.closeDeputation(tx, msg.tenantId, p.deputationId, { ...cols, updatedBy: msg.actorId }, p.expectedVersion);
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "hrms", action: "update_pay_terms", resourceType: "deputation", resourceId: p.deputationId,
          outcome: "success",
          metadata: { fields: Object.keys(p.terms), moneyFields: money.fields, before: diff.before, after: diff.after },
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "deputation", p.deputationId));
    log.info({ messageId: msg.messageId }, "deputation pay terms updated");
  });

  log.info("deputation consumers registered");
}
