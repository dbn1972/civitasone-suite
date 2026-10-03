/**
 * GAP-PAYROLL-STATUTORY-GRATUITY-01: persist a tenant's effective-dated
 * gratuity rule row and audit the before/after resolved rule.
 */
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { audit } from "../payroll/consumer.js";
import type { CreateGratuityRuleBody } from "./api.js";
import { loadGratuityRuleRows, resolveGratuityRule, serializeGratuityRule } from "./rules.js";

export function registerGratuityRuleConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.gratuityRuleCreate, async (msg) => {
    const p = msg.payload as CreateGratuityRuleBody & { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = resolveGratuityRule(await loadGratuityRuleRows(tx, msg.tenantId), p.effectiveFrom);
      const inserted = (await tx.execute(sql`
        INSERT INTO statutory.gratuity_rule_config
          (id, tenant_id, effective_from, rule_set, min_service_years, ceiling_minor, change_reason, created_by)
        VALUES (${p.id}::uuid, ${msg.tenantId}::uuid, ${p.effectiveFrom}::date, ${p.ruleSet},
                ${p.minServiceYears}::integer, ${p.ceilingMinor}::bigint, ${p.changeReason}, ${msg.actorId}::uuid)
        ON CONFLICT (tenant_id, effective_from) DO NOTHING
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (inserted.length === 0) {
        throw new NonRetryableError(`RULE_EXISTS_FOR_DATE: tenant already has a gratuity rule effective ${p.effectiveFrom}`);
      }
      const after = resolveGratuityRule(await loadGratuityRuleRows(tx, msg.tenantId), p.effectiveFrom);
      await audit(tx, msg, "create", "gratuity_rule_config", p.id, {
        effectiveFrom: p.effectiveFrom, changeReason: p.changeReason,
        before: serializeGratuityRule(before), after: serializeGratuityRule(after),
      });
    });
  });
}
