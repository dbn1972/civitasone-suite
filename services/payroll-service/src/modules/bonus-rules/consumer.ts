import { NonRetryableError, type Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { audit } from "../payroll/consumer.js";
import type { CreateBonusRuleBody } from "./api.js";
import { loadBonusRuleRows, resolveBonusRule, serializeBonusRule } from "./rules.js";

export function registerBonusRuleConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.bonusRuleCreate, async (msg) => {
    const p = msg.payload as CreateBonusRuleBody & { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = resolveBonusRule(await loadBonusRuleRows(tx, msg.tenantId), p.effectiveFrom);
      const inserted = (await tx.execute(sql`
        INSERT INTO statutory.bonus_rule_config
          (id, tenant_id, effective_from, wage_ceiling_minor, eligibility_ceiling_minor, min_bonus_bps, max_bonus_bps, change_reason, created_by)
        VALUES (${p.id}::uuid, ${msg.tenantId}::uuid, ${p.effectiveFrom}::date,
                ${p.wageCeilingMinor ?? null}::bigint, ${p.eligibilityCeilingMinor ?? null}::bigint,
                ${p.minBonusBps ?? null}::integer, ${p.maxBonusBps ?? null}::integer, ${p.changeReason}, ${msg.actorId}::uuid)
        ON CONFLICT (tenant_id, effective_from) DO NOTHING
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (inserted.length === 0) throw new NonRetryableError(`RULE_EXISTS_FOR_DATE: tenant already has a bonus rule effective ${p.effectiveFrom}`);
      const after = resolveBonusRule(await loadBonusRuleRows(tx, msg.tenantId), p.effectiveFrom);
      await audit(tx, msg, "create", "bonus_rule_config", p.id, {
        effectiveFrom: p.effectiveFrom, changeReason: p.changeReason,
        before: serializeBonusRule(before), after: serializeBonusRule(after),
      });
    });
  });
}
