/**
 * Costing-rule edit consumer (GAP-PAYROLL-COSTING-02). One transaction: inbox
 * dedup -> per-group advisory lock -> row lock -> cap re-check -> UPDATE ->
 * outbox event + audit. A command that loses a race (rule gone, group would
 * exceed 100%) changes nothing and is recorded as a failed audit event.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import type { CostingRuleUpdatePayload } from "./commands.js";
import { exceedsCap, lockCostingGroup, otherActiveSplitHundredths } from "./split-cap.js";

const AUDIT = "audit.event.record";

export function registerCostingRuleConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.costingRuleUpdate, async (msg) => {
    const p = msg.payload as CostingRuleUpdatePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const audit = (outcome: "success" | "failure", detail: Record<string, unknown>) => enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "payroll", action: "costing_rule_update", resourceType: "payroll_costing_rule", resourceId: p.ruleId, outcome, detail },
      });

      // The group is only known from the row, so read it first (no lock),
      // take the group lock, then re-read the row FOR UPDATE.
      const peek = (await tx.execute(sql`
        SELECT employee_group FROM payroll.costing_rules
         WHERE id = ${p.ruleId}::uuid AND tenant_id = ${msg.tenantId}::uuid
      `)) as unknown as Array<{ employee_group: string }>;
      if (!peek[0]) { await audit("failure", { code: "NOT_FOUND" }); return; }
      await lockCostingGroup(tx, msg.tenantId, peek[0].employee_group);

      const cur = (await tx.execute(sql`
        SELECT employee_group, cost_center_id, split_pct::text AS split_pct, status
          FROM payroll.costing_rules
         WHERE id = ${p.ruleId}::uuid AND tenant_id = ${msg.tenantId}::uuid FOR UPDATE
      `)) as unknown as Array<{ employee_group: string; cost_center_id: string; split_pct: string; status: string }>;
      if (!cur[0]) { await audit("failure", { code: "NOT_FOUND" }); return; }

      const nextStatus = p.status ?? cur[0].status;
      const nextSplit = p.splitPct ?? Number(cur[0].split_pct);
      if (nextStatus === "active") {
        const others = await otherActiveSplitHundredths(tx, msg.tenantId, cur[0].employee_group, { ruleId: p.ruleId });
        if (exceedsCap(others, nextSplit)) {
          await audit("failure", { code: "COSTING_SPLIT_EXCEEDS_100", otherHundredths: others, requestedSplitPct: nextSplit });
          return;
        }
      }
      await tx.execute(sql`
        UPDATE payroll.costing_rules SET split_pct = ${nextSplit}, status = ${nextStatus}
         WHERE id = ${p.ruleId}::uuid AND tenant_id = ${msg.tenantId}::uuid
      `);
      await enqueue(tx, {
        topic: EVENTS.costingRuleUpdated, eventType: EVENTS.costingRuleUpdated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id: p.ruleId, employeeGroup: cur[0].employee_group, costCenterId: cur[0].cost_center_id, status: nextStatus, splitPct: nextSplit },
      });
      await audit("success", {
        employeeGroup: cur[0].employee_group, costCenterId: cur[0].cost_center_id,
        from: { splitPct: Number(cur[0].split_pct), status: cur[0].status }, to: { splitPct: nextSplit, status: nextStatus },
      });
    });
  });
}
