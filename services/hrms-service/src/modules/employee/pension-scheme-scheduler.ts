/**
 * UAT b18 D1: switch hrms_employees.pension_scheme on the effective date of an
 * approved, future-dated pension scheme change (one already effective at
 * approval is applied by the approve route itself). Payroll does not depend
 * on this tick -- the payroll-input feed resolves the scheme in effect per
 * month from the approved history -- but the GPF / NPS / CPF ledgers check the
 * recorded scheme, so it must follow the effective date.
 *
 * Same tenant-discovery pattern as lifecycle/effective-scheduler.ts: tenant ids
 * via the scoped platform-bypass read, then each tenant's rows under its own
 * strict-RLS context. Per-row failures are logged and retried next tick.
 * Idempotent: a row is applied once (applied_at), under a row lock.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { SAFE_LOG_SERIALIZERS } from "../../shared/safe-error-log.js";
import type { Db } from "../../shared/db.js";
import { scopedPlatformRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { todayIST } from "../../shared/ist.js";
import * as employeeRepo from "./repo.js";
import { hrmsEmployees, hrmsPensionSchemeChanges } from "./schema.js";

const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
const AUDIT = "audit.event.record";
const log = pino({ name: "hrms_pension_scheme_effective", serializers: SAFE_LOG_SERIALIZERS });

export interface PensionSchemeTickResult { runDate: string; applied: number; failed: number }

export async function applyDuePensionSchemeChangesOnce(db: Db, opts: { asOf?: string } = {}): Promise<PensionSchemeTickResult> {
  const runDate = opts.asOf ?? todayIST();
  let applied = 0;
  let failed = 0;
  const tenantIds = await scopedPlatformRead((tx) => employeeRepo.listEmployeeTenantIds(tx));
  for (const tenantId of tenantIds) {
    let due: string[];
    try {
      due = await runWithTenant(tenantId, () => db.transaction(async (tx) => {
        const rows = await tx.select({ id: hrmsPensionSchemeChanges.id }).from(hrmsPensionSchemeChanges)
          .where(and(eq(hrmsPensionSchemeChanges.tenantId, tenantId), eq(hrmsPensionSchemeChanges.status, "approved"),
            isNull(hrmsPensionSchemeChanges.appliedAt), lte(hrmsPensionSchemeChanges.effectiveFrom, runDate)));
        return rows.map((r) => r.id);
      }));
    } catch (err) {
      log.error({ err, tenantId }, "pension scheme tick: tenant discovery failed; retried next tick");
      continue;
    }
    for (const changeId of due) {
      try {
        const employeeId = await runWithTenant(tenantId, () => db.transaction(async (tx) => {
          const [c] = await tx.select().from(hrmsPensionSchemeChanges)
            .where(and(eq(hrmsPensionSchemeChanges.id, changeId), eq(hrmsPensionSchemeChanges.tenantId, tenantId), isNull(hrmsPensionSchemeChanges.appliedAt)))
            .for("update").limit(1);
          if (!c) return null; // raced: applied since discovery
          const now = new Date();
          const [emp] = await tx.select({ pensionScheme: hrmsEmployees.pensionScheme }).from(hrmsEmployees)
            .where(and(eq(hrmsEmployees.id, c.employeeId), eq(hrmsEmployees.tenantId, tenantId))).for("update").limit(1);
          await tx.update(hrmsEmployees)
            .set({ pensionScheme: c.toScheme, updatedBy: SYSTEM_ACTOR, updatedAt: now, version: sql`${hrmsEmployees.version} + 1` })
            .where(and(eq(hrmsEmployees.id, c.employeeId), eq(hrmsEmployees.tenantId, tenantId)));
          await tx.update(hrmsPensionSchemeChanges)
            .set({ appliedAt: now, updatedBy: SYSTEM_ACTOR, updatedAt: now, version: sql`${hrmsPensionSchemeChanges.version} + 1` })
            .where(and(eq(hrmsPensionSchemeChanges.id, c.id), eq(hrmsPensionSchemeChanges.tenantId, tenantId)));
          await enqueue(tx, {
            topic: AUDIT, eventType: AUDIT, tenantId, actorId: SYSTEM_ACTOR, correlationId: randomUUID(),
            payload: {
              service: "hrms", action: "pension_scheme_change_apply", resourceType: "employee", resourceId: c.employeeId, outcome: "success",
              oldValue: { pensionScheme: emp?.pensionScheme ?? c.fromScheme }, newValue: { pensionScheme: c.toScheme, effectiveFrom: c.effectiveFrom },
              reason: c.reason, detail: { changeId: c.id, approvedBy: c.decidedBy, runDate },
            },
          });
          return c.employeeId;
        }));
        if (employeeId) {
          applied += 1;
          await cache.invalidate(cache.makeKey(tenantId, "employee", employeeId));
          await cache.invalidateResource(tenantId, "employee");
        }
      } catch (err) {
        failed += 1;
        log.error({ err, tenantId, changeId }, "pension scheme tick: failed to apply a due change; retried next tick");
      }
    }
  }
  log.info({ event: "scheduler.tick", runDate, applied, failed }, "pension scheme effective-date tick completed");
  return { runDate, applied, failed };
}
