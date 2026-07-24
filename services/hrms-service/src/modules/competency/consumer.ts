import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { resolveCertifiedLevel } from "./domain.js";
import * as repo from "./repo.js";

const AUDIT = "audit.event.record";

/**
 * SVC-124 cross-service consumer — assessment.certificate.issued → held competency.
 *
 * assessment-service (in-service module) emits `assessment.certificate.issued`
 * with { tenant_id, employee_id, assessment_id, certificate_no, competency_ref }
 * when a certificate is issued. competency_ref is the competency CODE the
 * assessment certifies. This consumer resolves that code to a competency and
 * raises the employee's held level to the competency's certifiedLevel (never
 * regressing a higher held level — see repo GREATEST). Source is 'assessment'
 * and the certificate number is stored as evidence.
 *
 * Idempotent on two levels: markProcessed (messageId inbox) drops duplicate
 * deliveries; the unique (tenant, employee, competency) upsert is naturally
 * replay-safe. When competency_ref is absent or does not resolve, the event is
 * acknowledged as a no-op (the outbox/audit trail records the miss).
 */
export function registerCompetencyConsumers(queue: Queue): void {
  queue.subscribe(EVENTS.certificateIssued, async (msg) => {
    const p = msg.payload as {
      tenant_id?: string; employee_id?: string; assessment_id?: string;
      certificate_no?: string; competency_ref?: string | null;
    };
    if (!p?.employee_id) return; // malformed — nothing to attribute

    await runWithTenant(msg.tenantId, async () => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return; // duplicate delivery

        const code = p.competency_ref ?? null;
        if (!code) {
          // Certificate not mapped to a competency — record a no-op for audit.
          await audit(tx, msg, "certificate_no_competency", "employee_competency", p.employee_id!);
          return;
        }
        const comp = await repo.getCompetencyByCodeTx(tx, msg.tenantId, code);
        if (!comp) {
          await audit(tx, msg, "certificate_unknown_competency", "employee_competency", p.employee_id!);
          return;
        }
        const level = resolveCertifiedLevel(comp);
        await repo.upsertEmployeeCompetency(tx, {
          tenantId: msg.tenantId, employeeId: p.employee_id!, competencyId: comp.id,
          currentLevel: level, source: "assessment", evidenceRef: p.certificate_no ?? null,
        });
        await audit(tx, msg, "competency_certified", "employee_competency", p.employee_id!, {
          competencyId: comp.id, level, certificateNo: p.certificate_no ?? null,
        });
      });
    });
  });
}

async function audit(
  tx: any, msg: any, action: string, resourceType: string, resourceId: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType, resourceId, outcome: "success", ...extra },
  });
}
