import { eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { notificationAlertRules, type AlertRuleInsert } from "./schema.js";
import type { AlertRuleView } from "./domain.js";

function toView(r: typeof notificationAlertRules.$inferSelect): AlertRuleView {
  return {
    id: r.id, tenantId: r.tenantId, name: r.name, triggerEvent: r.triggerEvent,
    conditions: r.conditions ?? {}, channel: r.channel, recipients: r.recipients ?? [],
    enabled: r.enabled, version: r.version,
  };
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findRulesByTenant(tenantId: string): Promise<AlertRuleView[]> {
  return (await scopedRead((tx) => tx.select().from(notificationAlertRules).where(eq(notificationAlertRules.tenantId, tenantId)))).map(toView);
}

export async function findRuleById(id: string): Promise<AlertRuleView | null> {
  const rows = await scopedRead((tx) => tx.select().from(notificationAlertRules).where(eq(notificationAlertRules.id, id)).limit(1));
  return rows[0] ? toView(rows[0]) : null;
}

export async function insertRule(tx: Writer, row: AlertRuleInsert): Promise<void> {
  await tx.insert(notificationAlertRules).values(row);
}

export async function setRuleEnabled(tx: Writer, id: string, enabled: boolean, actorId: string): Promise<void> {
  const rows = await tx.select().from(notificationAlertRules).where(eq(notificationAlertRules.id, id)).limit(1);
  const current = rows[0];
  if (!current) return;
  await tx.update(notificationAlertRules).set({
    enabled, updatedBy: actorId, updatedAt: new Date(), version: current.version + 1,
  }).where(eq(notificationAlertRules.id, id));
}
