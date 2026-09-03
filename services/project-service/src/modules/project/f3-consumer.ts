// @ts-nocheck — F3 leftover consumer for world-class project routes
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "project-f3-world-class" });
const AUDIT_TOPIC = "audit.event.record";

async function audit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx as never, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "project", action, resourceType, resourceId, outcome: "success" },
  });
}

export function registerF3ProjectConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "risk_create", "evm_compute", "ra_bill_create", "ra_bill_approve",
      "time_ext_create", "time_ext_approve", "penalty_create", "resource_allocate",
    ]);
    if (!ops.has(op)) return;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "risk_create": {
            const rows = await tx.execute(sql`
              INSERT INTO project.project_risks (id, tenant_id, project_id, title, description, category, probability, impact, risk_score, mitigation_plan, owner_id, status, created_by)
              VALUES (${p.id}, ${p.tenantId}, ${p.projectId}, ${p.title}, ${p.description ?? null}, ${p.category}, ${p.probability}, ${p.impact}, ${p.riskScore}, ${p.mitigationPlan ?? null}, ${p.ownerId ?? null}, ${p.status}, ${msg.actorId})
              RETURNING id
            `);
            const rid = (rows[0] as { id: string }).id;
            await audit(tx, msg, "create", "project_risk", rid);
            break;
          }
          case "evm_compute": {
            await tx.execute(sql`
              INSERT INTO project.project_evm (tenant_id, project_id, period, planned_value_minor, earned_value_minor, actual_cost_minor, cpi, spi, eac_minor, etc_minor, variance_at_completion_minor)
              VALUES (${p.tenantId}, ${p.projectId}, ${p.period}, ${p.pv}, ${p.ev}, ${p.ac}, ${p.cpi}, ${p.spi}, ${p.eac}, ${p.etc}, ${p.vac})
              ON CONFLICT (tenant_id, project_id, period) DO UPDATE SET
                planned_value_minor = EXCLUDED.planned_value_minor,
                earned_value_minor = EXCLUDED.earned_value_minor,
                actual_cost_minor = EXCLUDED.actual_cost_minor,
                cpi = EXCLUDED.cpi, spi = EXCLUDED.spi,
                eac_minor = EXCLUDED.eac_minor, etc_minor = EXCLUDED.etc_minor,
                variance_at_completion_minor = EXCLUDED.variance_at_completion_minor,
                computed_at = NOW()
            `);
            await audit(tx, msg, "compute", "project_evm", `${p.projectId}:${p.period}`);
            break;
          }
          case "ra_bill_create": {
            // id must be forwarded from the route (RETURNING id previously
            // let Postgres mint a fresh gen_random_uuid() instead) — the
            // 202 response already handed the caller `p.id` as the bill id,
            // so a mismatched persisted id made every follow-up
            // approve/lookup 404 forever.
            const rows = await tx.execute(sql`
              INSERT INTO project.project_ra_bills (id, tenant_id, project_id, contractor_id, contractor_name, bill_no, bill_date, work_description, gross_amount_minor, deductions_minor, net_amount_minor, cumulative_minor, status, created_by)
              VALUES (${p.id}, ${p.tenantId}, ${p.projectId}, ${p.contractorId}, ${p.contractorName ?? null}, ${p.billNo}, ${p.billDate}, ${p.workDescription ?? null}, ${p.gross}, ${p.deductions}, ${p.net}, ${p.cumulative}, ${"submitted"}, ${msg.actorId})
              RETURNING id
            `);
            const rid = (rows[0] as { id: string }).id;
            await audit(tx, msg, "submit", "ra_bill", rid);
            break;
          }
          case "ra_bill_approve": {
            const upd = await tx.execute(sql`
              UPDATE project.project_ra_bills
              SET status = 'approved', approved_by = ${msg.actorId}
              WHERE id = ${p.billId} AND tenant_id = ${p.tenantId} AND project_id = ${p.projectId}
                AND status IN ('submitted','verified')
              RETURNING id
            `);
            if (upd.length === 0) return;
            await audit(tx, msg, "approve", "ra_bill", p.billId as string);
            break;
          }
          case "time_ext_create": {
            // Same id-forwarding fix as ra_bill_create above — without an
            // explicit id, Postgres minted a new one and the id returned in
            // the 202 response could never be approved or found again.
            const rows = await tx.execute(sql`
              INSERT INTO project.project_time_extensions (id, tenant_id, project_id, original_end_date, extended_end_date, extension_days, reason, penalty_applicable, penalty_per_day_minor, status, created_by)
              VALUES (${p.id}, ${p.tenantId}, ${p.projectId}, ${p.originalEndDate}, ${p.extendedEndDate}, ${p.extensionDays}, ${p.reason}, ${p.penaltyApplicable}, ${p.penaltyPerDay}, ${"requested"}, ${msg.actorId})
              RETURNING id
            `);
            const rid = (rows[0] as { id: string }).id;
            await audit(tx, msg, "request", "time_extension", rid);
            break;
          }
          case "time_ext_approve": {
            const upd = await tx.execute(sql`
              UPDATE project.project_time_extensions
              SET status = 'approved', approved_by = ${msg.actorId}, approval_date = CURRENT_DATE
              WHERE id = ${p.extId} AND tenant_id = ${p.tenantId} AND project_id = ${p.projectId}
                AND status = 'requested'
              RETURNING id
            `);
            if (upd.length === 0) return;
            await audit(tx, msg, "approve", "time_extension", p.extId as string);
            break;
          }
          case "penalty_create": {
            // Same id-forwarding fix as ra_bill_create above.
            const rows = await tx.execute(sql`
              INSERT INTO project.project_penalties (id, tenant_id, project_id, contractor_id, penalty_type, from_date, to_date, days, rate_per_day_minor, total_minor, recovered, recovered_from, created_by)
              VALUES (${p.id}, ${p.tenantId}, ${p.projectId}, ${p.contractorId ?? null}, ${p.penaltyType}, ${p.fromDate}, ${p.toDate}, ${p.days}, ${p.ratePerDay}, ${p.total}, ${false}, ${p.recoveredFrom ?? null}, ${msg.actorId})
              RETURNING id
            `);
            const rid = (rows[0] as { id: string }).id;
            await audit(tx, msg, "levy", "penalty", rid);
            break;
          }
          case "resource_allocate": {
            // Same id-forwarding fix as ra_bill_create above.
            const rows = await tx.execute(sql`
              INSERT INTO project.project_resources (id, tenant_id, project_id, task_id, resource_type, resource_id, resource_name, allocated_hours, daily_rate_minor, from_date, to_date, status, created_by)
              VALUES (${p.id}, ${p.tenantId}, ${p.projectId}, ${p.taskId ?? null}, ${p.resourceType}, ${p.resourceId ?? null}, ${p.resourceName}, ${p.allocatedHours ?? null}, ${p.dailyRate}, ${p.fromDate ?? null}, ${p.toDate ?? null}, ${"allocated"}, ${msg.actorId})
              RETURNING id
            `);
            const rid = (rows[0] as { id: string }).id;
            await audit(tx, msg, "allocate", "resource", rid);
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
