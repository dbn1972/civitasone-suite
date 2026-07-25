import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT = "audit.event.record";

/**
 * SVC-003 fill-loop consumer — hrms.recruitment.position_filled → plan fill.
 *
 * The recruitment hire consumer emits `hrms.recruitment.position_filled` with
 * { jobOpeningId, employeeId, tenantId } when an application is hired. If that
 * job opening was auto-generated FROM an approved manpower plan (a
 * manpower.requisitions row links job_opening_id → plan_id), this consumer:
 *   • increments the requisition's filled_count (flipping it to 'filled' once
 *     the requested vacancies are met), and
 *   • bumps the plan's filled_strength by one (which shrinks the computed
 *     vacancy = sanctioned − filled) — closing the plan → requisition → hire loop.
 *
 * Idempotent via markProcessed (messageId inbox). A hire against an opening that
 * did NOT originate from a plan is acknowledged as an audited no-op.
 */
export function registerManpowerConsumers(queue: Queue): void {
  queue.subscribe(EVENTS.positionFilled, async (msg) => {
    const p = msg.payload as { jobOpeningId?: string; employeeId?: string; tenantId?: string };
    if (!p?.jobOpeningId) return; // malformed — cannot map to a requisition

    await runWithTenant(msg.tenantId, async () => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return; // duplicate delivery

        const requisition = await repo.findRequisitionByJobOpeningTx(tx, msg.tenantId, p.jobOpeningId!);
        if (!requisition) {
          await audit(tx, msg, "hire_no_requisition", "manpower_requisition", p.jobOpeningId!);
          return;
        }

        await repo.incrementRequisitionFillTx(tx, msg.tenantId, requisition.id);
        await repo.bumpFilledStrengthTx(tx, msg.tenantId, requisition.planId, 1);

        await audit(tx, msg, "position_filled", "manpower_requisition", requisition.id, {
          planId: requisition.planId, employeeId: p.employeeId ?? null,
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
