import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { automationRules } from "./schema.js";
import { evaluateRules } from "./domain.js";
import type { AutomationRuleRow } from "./schema.js";

export async function listRules(tenantId: string, limit: number, offset: number) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(automationRules)
      .where(and(eq(automationRules.tenantId, tenantId), eq(automationRules.status, "active")))
      .orderBy(asc(automationRules.ordinal))
      .limit(limit)
      .offset(offset);

    const [countRow] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(automationRules)
      .where(and(eq(automationRules.tenantId, tenantId), eq(automationRules.status, "active")));

    return { rows, total: countRow?.total ?? 0 };
  });
}

export async function getRule(tenantId: string, id: string): Promise<AutomationRuleRow | null> {
  const [rule] = await db.transaction((tx) =>
    tx.select().from(automationRules)
      .where(and(eq(automationRules.id, id), eq(automationRules.tenantId, tenantId)))
      .limit(1),
  );
  return rule ?? null;
}

export async function evaluate(
  tenantId: string,
  body: {
    fields: Record<string, string | undefined>;
    elapsedMinutes: number;
    subject: string;
    description?: string | undefined;
  },
) {
  const rules = await db.transaction((tx) =>
    tx.select().from(automationRules).where(
      and(
        eq(automationRules.tenantId, tenantId),
        eq(automationRules.status, "active"),
        eq(automationRules.enabled, true),
      ),
    ).orderBy(asc(automationRules.ordinal)),
  );

  return evaluateRules(
    {
      fields: body.fields,
      elapsedMinutes: body.elapsedMinutes,
      subject: body.subject,
      description: body.description,
    },
    rules.map((r) => ({
      id: r.id,
      name: r.name,
      ordinal: r.ordinal,
      enabled: r.enabled,
      trigger: r.trigger,
      actions: r.actions,
    })),
  );
}
