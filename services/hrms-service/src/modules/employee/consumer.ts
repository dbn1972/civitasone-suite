import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { isExitedStatus } from "./status.js";
import * as lifecycleRepo from "../lifecycle/repo.js";
import { computePension, elEncashment, qualifyingService } from "../pension/engine.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT = "audit.event.record";

/**
 * Default Dearness Allowance rate (% of basic) used when computing separation
 * settlement (DCRG + EL encashment). The separation command does not carry a DA
 * rate, so we apply the current CCS DA rate as a documented default. EL balance
 * is taken from the separation payload's `encashmentDays` (capped at 300 by the
 * EL encashment formula).
 */
const DEFAULT_DA_RATE_PCT = 50;

/** ISO 'YYYY-MM-DD' for "today", used to decide whether an effectiveDate is due. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerEmployeeConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.employeeCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeNo: string; fullName: string;
      departmentId: string; designationId: string; dateOfJoining: string;
      employeeType: string; basicMinor: number; currency: string;
      dateOfBirth?: string; gender?: string; pan?: string; aadhaarRef?: string;
      mobile?: string; email?: string; bankAccountNo?: string; bankIfsc?: string;
      payStructureId?: string;
      legalEntityId?: string; costCenterId?: string; locationId?: string;
      esicIpNumber?: string; uanNumber?: string; pran?: string; gstin?: string; sacCode?: string; agencyRef?: string; napsId?: string;
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
        ...(p.legalEntityId ? { legalEntityId: p.legalEntityId } : {}),
        ...(p.costCenterId ? { costCenterId: p.costCenterId } : {}),
        ...(p.locationId ? { locationId: p.locationId } : {}),
        esicIpNumber: p.esicIpNumber ?? null, uanNumber: p.uanNumber ?? null, pran: p.pran ?? null,
        gstin: p.gstin ?? null, sacCode: p.sacCode ?? null,
        agencyRef: p.agencyRef ?? null, napsId: p.napsId ?? null,
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
    // M1: invalidate list cache so new employee appears in paginated lists
    await cache.invalidateResource(msg.tenantId, "employee");
  });

  queue.subscribe(COMMANDS.employeeConfirm, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; confirmationDate: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // SEC CRITICAL (status-integrity fix): confirmEmployee used to write
      // status: "confirmed" unconditionally, with no check on the employee's
      // prior state — a terminated/separated/retired employee (or one already
      // confirmed) could be silently "re-confirmed". The route now performs a
      // synchronous pre-check (employee/routes.ts) for the common case, but
      // this consumer runs async off a queue, so it re-verifies the
      // precondition here too, immediately before writing, and enforces it
      // atomically via updateEmployeeIfStatus's WHERE-guarded UPDATE — closing
      // the race window between the route's read and this write (e.g. a
      // concurrent separate/terminate landing in between; hrms_employees has
      // no version bump on plain writes for the guard to lean on instead).
      // "probation" is the only state confirmation is ever valid from — every
      // other status (including "confirmed" itself) is rejected.
      const emp = await repo.findByIdTx(tx, p.id, p.tenantId);
      if (!emp) throw new HttpError(404, "NOT_FOUND", `employee ${p.id} not found`);
      if (emp.status !== "probation") {
        throw new HttpError(
          409,
          "INVALID_STATUS_TRANSITION",
          `employee ${p.id} cannot be confirmed from status '${emp.status}' — only an employee in 'probation' status can be confirmed`,
        );
      }
      const applied = await repo.updateEmployeeIfStatus(tx, p.id, p.tenantId, "probation", {
        status: "confirmed", confirmationDate: p.confirmationDate, updatedBy: msg.actorId,
      });
      if (!applied) {
        throw new HttpError(409, "EMPLOYEE_STATUS_CONFLICT", `employee ${p.id} status changed since it was read; refusing to confirm`);
      }
      await audit(tx, msg, "confirm", "employee", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.id));
    // M1: status change visible in list
    await cache.invalidateResource(msg.tenantId, "employee");
  });

  queue.subscribe(COMMANDS.employeeTransfer, async (msg) => {
    const p = msg.payload as {
      employeeId: string; tenantId: string; fromDeptId: string; toDeptId: string;
      fromDesigId?: string; toDesigId?: string; effectiveDate: string; orderRef?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Effective-dating fix (migration 0144): a transfer whose effectiveDate
      // is still in the future must NOT be applied to the employee master
      // yet — it is recorded "pending_effective" and picked up later by the
      // scheduler (lifecycle/effective-scheduler.ts) once that date arrives.
      // A transfer effective today or earlier keeps the prior immediate-
      // apply behaviour (still "completed" the moment it's recorded).
      const due = lifecycleRepo.isEffectiveDateDue(p.effectiveDate, todayISO());
      await lifecycleRepo.insertTransfer(tx, {
        id: msg.messageId, tenantId: p.tenantId, employeeId: p.employeeId,
        fromDeptId: p.fromDeptId, toDeptId: p.toDeptId,
        fromDesigId: p.fromDesigId ?? null, toDesigId: p.toDesigId ?? null,
        effectiveDate: p.effectiveDate, orderRef: p.orderRef ?? null,
        status: due ? "completed" : "pending_effective",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (due) {
        // Previously ALSO set status: "transferred" directly on this update —
        // that value was never part of the canonical employee status
        // contract (employee/status.ts's EMPLOYEE_STATUSES / the
        // hrms_employees_status_check CHECK constraint added by migration
        // 0025, never widened for it the way "no_show" was in migration
        // 0130). That write always violated the CHECK constraint, so this
        // WHOLE transaction — including the transfer record and the
        // markProcessed insert above — silently rolled back on every direct
        // transfer; nothing here ever actually persisted. applyTransferEffect
        // (shared with the eOffice-approved transfer path, which never had
        // this bug) applies only departmentId/designationId.
        await lifecycleRepo.applyTransferEffect(tx, {
          tenantId: p.tenantId, employeeId: p.employeeId, toDeptId: p.toDeptId, toDesigId: p.toDesigId ?? null,
        }, msg.actorId);
      }
      await audit(tx, msg, "transfer", "employee", p.employeeId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
    // M1: department and status change visible in list
    await cache.invalidateResource(msg.tenantId, "employee");
  });

  // eOffice loop — record a transfer REQUEST in `pending_approval` rather than
  // mutating the employee master. The eFile is raised against this transfer id
  // (source_ref_type "hr_transfer"); the decision arrives on
  // hrms.transfer.file_decided and is applied by the eoffice-consumer.
  queue.subscribe(COMMANDS.employeeTransferSubmitApproval, async (msg) => {
    const p = msg.payload as {
      id: string; employeeId: string; tenantId: string; fromDeptId: string; toDeptId: string;
      fromDesigId?: string; toDesigId?: string; effectiveDate: string; orderRef?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lifecycleRepo.insertTransfer(tx, {
        id: p.id, tenantId: p.tenantId, employeeId: p.employeeId,
        fromDeptId: p.fromDeptId, toDeptId: p.toDeptId,
        fromDesigId: p.fromDesigId ?? null, toDesigId: p.toDesigId ?? null,
        effectiveDate: p.effectiveDate, orderRef: p.orderRef ?? null,
        status: "pending_approval",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "submit_for_eoffice_approval", "transfer", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "transfer", p.id));
  });

  // eOffice loop — record a promotion REQUEST in `pending_approval` rather than
  // mutating the employee master. The eFile is raised against this promotion id
  // (source_ref_type "hr_promotion"); the decision arrives on
  // hrms.promotion.file_decided and is applied by the promotion eoffice-consumer.
  queue.subscribe(COMMANDS.employeePromotionSubmitApproval, async (msg) => {
    const p = msg.payload as {
      id: string; employeeId: string; tenantId: string;
      fromDesigId: string; toDesigId: string; effectiveDate: string;
      orderRef?: string; newBasicMinor?: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lifecycleRepo.insertPromotion(tx, {
        id: p.id, tenantId: p.tenantId, employeeId: p.employeeId,
        fromDesigId: p.fromDesigId, toDesigId: p.toDesigId,
        effectiveDate: p.effectiveDate, orderRef: p.orderRef ?? null,
        newBasicMinor: p.newBasicMinor !== undefined ? BigInt(p.newBasicMinor) : null,
        status: "pending_approval",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "submit_for_eoffice_approval", "promotion", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "promotion", p.id));
  });

  queue.subscribe(COMMANDS.employeeSeparate, async (msg) => {
    const p = msg.payload as {
      employeeId: string; tenantId: string; separationType: string;
      effectiveDate: string; lastWorkingDate?: string; encashmentDays: number; remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const emp = await repo.findByIdTx(tx, p.employeeId, p.tenantId);
      const basicMinor = emp?.basicMinor ?? 0n;

      // Settlement computation (CCS rules):
      //  - EL encashment = (Basic+DA)/30 * min(EL_balance, 300 days)
      //  - DCRG (gratuity) = 1/4 * (Basic+DA) * completed_half_years, capped
      //    at 16.5x emoluments and at Rs 20,00,000. Computed via the pension
      //    engine using last-drawn emoluments (GPF/old-scheme defined benefit).
      const encashmentMinor = elEncashment(basicMinor, DEFAULT_DA_RATE_PCT, p.encashmentDays);

      // H2 — DCRG / retirement gratuity is NOT payable on every separation.
      // Under CCS (Pension) Rules, retirement gratuity requires (a) a qualifying
      // separation cause AND (b) a minimum of 5 years' qualifying service. For
      // resignation / dismissal / removal the gratuity is forfeited (set to 0).
      // Eligible causes: superannuation/retirement, voluntary retirement (VRS),
      // death and invalidation. Forfeited: resignation, dismissal, removal,
      // termination. (Synonyms included to match the separation command enum.)
      const GRATUITY_ELIGIBLE_TYPES = new Set([
        "retirement", "superannuation", "vrs", "voluntary_retirement", "death", "invalidation",
      ]);
      const MIN_QUALIFYING_HALF_YEARS = 10; // 5 years
      let gratuityMinor = 0n;
      if (emp) {
        const sep = (p.separationType ?? "").toLowerCase();
        const qualifies = qualifyingService(emp.dateOfJoining, p.effectiveDate);
        const causeEligible = GRATUITY_ELIGIBLE_TYPES.has(sep);
        const serviceEligible = qualifies.halfYears >= MIN_QUALIFYING_HALF_YEARS;
        if (causeEligible && serviceEligible) {
          const pension = computePension({
            pensionScheme: emp.pensionScheme,
            dateOfJoining: emp.dateOfJoining,
            retirementDate: p.effectiveDate,
            lastBasicMinor: basicMinor,
            daRatePct: DEFAULT_DA_RATE_PCT,
          });
          gratuityMinor = pension.dcrg.payableMinor;
        }
        // else: forfeited / not yet qualified -> gratuity remains 0n.
      }

      await lifecycleRepo.insertSeparation(tx, {
        id: msg.messageId, tenantId: p.tenantId, employeeId: p.employeeId,
        separationType: p.separationType, effectiveDate: p.effectiveDate,
        lastWorkingDate: p.lastWorkingDate ?? null, encashmentDays: p.encashmentDays,
        encashmentMinor, gratuityMinor,
        remarks: p.remarks ?? null, status: "initiated",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateEmployee(tx, p.employeeId, { status: "separated", updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.employeeSeparated, eventType: EVENTS.employeeSeparated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          employeeId: p.employeeId,
          separationType: p.separationType,
          effectiveDate: p.effectiveDate,
          encashmentDays: p.encashmentDays,
          basicMinor: emp?.basicMinor?.toString() ?? "0",
          dateOfJoining: emp?.dateOfJoining ?? p.effectiveDate,
        },
      });
      await audit(tx, msg, "separate", "employee", p.employeeId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
    // M1: status change (separated) visible in list
    await cache.invalidateResource(msg.tenantId, "employee");
  });

  queue.subscribe(COMMANDS.employeeUpdate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      mobile?: string; email?: string;
      bankAccountNo?: string; bankIfsc?: string;
      basicMinor?: string; payStructureId?: string; managerId?: string;
      esicIpNumber?: string; uanNumber?: string; pran?: string; gstin?: string; sacCode?: string; agencyRef?: string; napsId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // SEC CRITICAL (status-integrity fix): this generic profile-update path
      // had NO status check at all — a terminated/separated/retired
      // employee's mobile/email/bank-account/IFSC etc. could still be edited
      // by any HR-role actor. Safer default: block the update entirely once
      // an employee has permanently exited (isExitedStatus — terminated,
      // separated, retired), rather than trying to allow-list which fields
      // are "safe" post-exit. There is no separate audited exception path for
      // post-exit corrections in this module today (fnf-route.ts's
      // /fnf-calculate is a pure read-only calculator, not a write path), so
      // this is a hard block, not a partial one.
      const emp = await repo.findByIdTx(tx, p.id, p.tenantId);
      if (!emp) throw new HttpError(404, "NOT_FOUND", `employee ${p.id} not found`);
      if (isExitedStatus(emp.status)) {
        throw new HttpError(
          409,
          "EMPLOYEE_EXITED",
          `employee ${p.id} has status '${emp.status}' and can no longer be updated via this endpoint`,
        );
      }
      const patch: Parameters<typeof repo.updateEmployee>[2] = { updatedBy: msg.actorId };
      const changedFields: string[] = [];
      if (p.mobile      !== undefined) { patch.mobile      = p.mobile; changedFields.push("mobile"); }
      if (p.email       !== undefined) { patch.email       = p.email; changedFields.push("email"); }
      if (p.bankAccountNo !== undefined) { patch.bankAccountNo = p.bankAccountNo; changedFields.push("bankAccountNo"); }
      if (p.bankIfsc    !== undefined) { patch.bankIfsc    = p.bankIfsc; changedFields.push("bankIfsc"); }
      if (p.basicMinor  !== undefined) { patch.basicMinor  = BigInt(p.basicMinor); changedFields.push("basicMinor"); }
      if (p.esicIpNumber !== undefined) { patch.esicIpNumber = p.esicIpNumber; changedFields.push("esicIpNumber"); }
      if (p.uanNumber   !== undefined) { patch.uanNumber   = p.uanNumber;   changedFields.push("uanNumber"); }
      if (p.pran        !== undefined) { patch.pran        = p.pran; changedFields.push("pran"); }
      if (p.gstin       !== undefined) { patch.gstin       = p.gstin; changedFields.push("gstin"); }
      if (p.sacCode     !== undefined) { patch.sacCode     = p.sacCode; changedFields.push("sacCode"); }
      if (p.agencyRef   !== undefined) { patch.agencyRef   = p.agencyRef; changedFields.push("agencyRef"); }
      if (p.napsId      !== undefined) { patch.napsId      = p.napsId; changedFields.push("napsId"); }
      if (p.payStructureId !== undefined) { patch.payStructureId = p.payStructureId; changedFields.push("payStructureId"); }
      if (p.managerId    !== undefined) { patch.managerId    = p.managerId; changedFields.push("managerId"); }
      if (patch.basicMinor !== undefined) {
        // Concurrency guard: this generic profile-update path lets an HR
        // admin edit basicMinor directly (PATCH /v1/hrms/employees/:id),
        // which can race the pay-matrix annual increment, the direct
        // promotion route, or the eOffice-approved promotion path — all
        // independent, asynchronous writers of the same field. Read the
        // row's current version fresh, inside this transaction, and use it
        // as an optimistic-concurrency precondition so this write can never
        // silently clobber (or be silently clobbered by) one of those. Every
        // other field on this path keeps the existing blind-overwrite
        // behaviour — only basicMinor needs this. See employee/repo.ts
        // updateEmployeeVersioned.
        const emp = await repo.findVersionForUpdate(tx, p.id, p.tenantId);
        if (!emp) throw new HttpError(404, "NOT_FOUND", `employee ${p.id} not found`);
        await repo.updateEmployeeVersioned(tx, p.id, p.tenantId, emp.version, patch, msg.actorId);
      } else {
        await repo.updateEmployee(tx, p.id, patch);
      }
      await enqueue(tx, {
        topic: EVENTS.employeeUpdated, eventType: EVENTS.employeeUpdated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { employeeId: p.id, tenantId: p.tenantId, changedFields },
      });
      await audit(tx, msg, "update", "employee", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.id));
    // M1: any field change may affect list display (name, email, status-derived fields)
    await cache.invalidateResource(msg.tenantId, "employee");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType, resourceId, outcome: "success" },
  });
}
