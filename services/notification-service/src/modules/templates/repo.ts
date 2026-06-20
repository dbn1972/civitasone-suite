import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { notificationTemplates, notificationPrefs, type TemplateInsert, type PrefInsert } from "./schema.js";
import type { TemplateView, PrefView } from "./domain.js";

function toTemplateView(r: typeof notificationTemplates.$inferSelect): TemplateView {
  return {
    id: r.id, tenantId: r.tenantId, channel: r.channel, name: r.name, subject: r.subject ?? null,
    body: r.body, status: r.status, version: r.version, supersededBy: r.supersededBy ?? null,
  };
}
function toPrefView(r: typeof notificationPrefs.$inferSelect): PrefView {
  return { id: r.id, tenantId: r.tenantId, userId: r.userId, eventType: r.eventType, inApp: r.inApp, email: r.email, push: r.push, version: r.version };
}

export async function findTemplateById(id: string): Promise<TemplateView | null> {
  const rows = await db.select().from(notificationTemplates).where(eq(notificationTemplates.id, id)).limit(1);
  return rows[0] ? toTemplateView(rows[0]) : null;
}

export async function findTemplatesByTenant(tenantId: string): Promise<TemplateView[]> {
  return (await db.select().from(notificationTemplates).where(
    and(eq(notificationTemplates.tenantId, tenantId), isNull(notificationTemplates.supersededBy)),
  )).map(toTemplateView);
}

export async function findTemplateVersions(id: string): Promise<TemplateView[]> {
  const start = await findTemplateById(id);
  if (!start) return [];

  let latest = start;
  while (latest.supersededBy) {
    const next = await findTemplateById(latest.supersededBy);
    if (!next) break;
    latest = next;
  }

  const versions: TemplateView[] = [latest];
  let current = latest;
  for (;;) {
    const preds = await db.select().from(notificationTemplates).where(eq(notificationTemplates.supersededBy, current.id)).limit(1);
    if (!preds[0]) break;
    const pred = toTemplateView(preds[0]);
    versions.unshift(pred);
    current = pred;
  }
  return versions;
}

export async function findPrefsByUser(userId: string): Promise<PrefView[]> {
  return (await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId))).map(toPrefView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertTemplate(tx: Writer, row: TemplateInsert): Promise<void> {
  await tx.insert(notificationTemplates).values(row);
}

export async function supersedeTemplate(tx: Writer, oldId: string, newId: string, actorId: string): Promise<void> {
  const rows = await tx.select().from(notificationTemplates).where(eq(notificationTemplates.id, oldId)).limit(1);
  const current = rows[0];
  if (!current) return;
  await tx.update(notificationTemplates).set({
    supersededBy: newId, status: "superseded", updatedBy: actorId,
    updatedAt: new Date(), version: current.version,
  }).where(eq(notificationTemplates.id, oldId));
}

export async function upsertPrefs(tx: Writer, row: PrefInsert): Promise<void> {
  const existing = await tx.select().from(notificationPrefs)
    .where(and(eq(notificationPrefs.userId, row.userId!), eq(notificationPrefs.eventType, row.eventType!)))
    .limit(1);
  if (existing.length) {
    await tx.update(notificationPrefs)
      .set({ inApp: row.inApp ?? true, email: row.email ?? true, push: row.push ?? false, updatedBy: row.updatedBy, version: (existing[0]?.version ?? 0) + 1, updatedAt: new Date() })
      .where(eq(notificationPrefs.id, existing[0]!.id));
  } else {
    await tx.insert(notificationPrefs).values(row);
  }
}

export async function findTemplateByIdTx(tx: Writer, id: string): Promise<TemplateView | null> {
  const rows = await tx.select().from(notificationTemplates).where(eq(notificationTemplates.id, id)).limit(1);
  return rows[0] ? toTemplateView(rows[0]) : null;
}
