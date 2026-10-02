/**
 * PAY-PROFILES: persist a tenant's effective-dated allowance-rule row (HRA
 * floor / deputation-allowance rule) and audit it with the resolved values
 * before and after, for the month it takes effect.
 */
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { audit } from "../payroll/consumer.js";
import { loadAllowanceRuleRows, resolveAllowanceRules } from "./allowance-rules.js";
import { lockedThroughMonth, serializeRules, type CreateAllowanceRulesBody } from "./rules-api.js";

const log = pino({ name: "payroll-allowance-rules" });

export function registerPayProfileConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.allowanceRulesCreate, async (msg) => {
    const p = msg.payload as CreateAllowanceRulesBody & { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const month = p.effectiveFrom.slice(0, 7);
      // Re-assert the lock at write time: a run may have been approved since the request.
      const locked = await lockedThroughMonth(tx, msg.tenantId);
      if (locked && month <= locked) throw new NonRetryableError(`PERIOD_LOCKED: payroll is locked through ${locked}`);
      const before = resolveAllowanceRules(await loadAllowanceRuleRows(tx, msg.tenantId), msg.tenantId, month);
      const inserted = (await tx.execute(sql`
        INSERT INTO statutory.allowance_rule_config
          (id, tenant_id, effective_from, hra_floor_x_minor, hra_floor_y_minor, hra_floor_z_minor,
           dep_allow_same_station_bps, dep_allow_same_station_cap_minor,
           dep_allow_other_station_bps, dep_allow_other_station_cap_minor, change_reason, created_by)
        VALUES
          (${p.id}::uuid, ${msg.tenantId}::uuid, ${p.effectiveFrom}::date,
           ${p.hraFloorXMinor ?? null}::bigint, ${p.hraFloorYMinor ?? null}::bigint, ${p.hraFloorZMinor ?? null}::bigint,
           ${p.depSameStation?.rateBps ?? null}::integer, ${p.depSameStation?.capMinor ?? null}::bigint,
           ${p.depOtherStation?.rateBps ?? null}::integer, ${p.depOtherStation?.capMinor ?? null}::bigint,
           ${p.changeReason}, ${msg.actorId}::uuid)
        ON CONFLICT (tenant_id, effective_from) DO NOTHING
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (inserted.length === 0) throw new NonRetryableError(`RULES_EXIST_FOR_DATE: tenant already has an allowance-rule row effective ${p.effectiveFrom}`);
      const after = resolveAllowanceRules(await loadAllowanceRuleRows(tx, msg.tenantId), msg.tenantId, month);
      await audit(tx, msg, "create", "allowance_rule_config", p.id, {
        effectiveFrom: p.effectiveFrom,
        changeReason: p.changeReason,
        before: serializeRules(before),
        after: serializeRules(after),
      });
    });
    log.info({ messageId: msg.messageId }, "allowance rules created");
  });
}
