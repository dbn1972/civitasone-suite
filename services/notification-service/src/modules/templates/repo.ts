import { eq, and, isNull } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { notificationTemplates, notificationPrefs, type TemplateInsert, type PrefInsert } from "./schema.js";
import type { TemplateView, PrefView } from "./domain.js";

function toTemplateView(r: typeof notificationTemplates.$inferSelect): TemplateView {
  return {
    id: r.id, tenantId: r.tenantId, channel: r.channel, name: r.name, subject: r.subject ?? null,
    body: r.body, status: r.status, version: r.version, supersededBy: r.supersededBy ?? null,
    contentType: r.contentType ?? null, submittedBy: r.submittedBy ?? null,
    submittedAt: r.submittedAt ?? null, approvedBy: r.approvedBy ?? null,
    approvedAt: r.approvedAt ?? null, rejectionReason: r.rejectionReason ?? null,
  };
}
function toPrefView(r: typeof notificationPrefs.$inferSelect): PrefView {
  return {
    id: r.id, tenantId: r.tenantId, userId: r.userId, eventType: r.eventType,
    inApp: r.inApp, email: r.email, push: r.push, sms: r.sms, whatsapp: r.whatsapp,
    version: r.version,
  };
}

export async function findTemplateById(id: string): Promise<TemplateView | null> {
  const rows = await scopedRead((tx) => tx.select().from(notificationTemplates).where(eq(notificationTemplates.id, id)).limit(1));
  return rows[0] ? toTemplateView(rows[0]) : null;
}

export async function findTemplatesByTenant(tenantId: string, limit = 500): Promise<TemplateView[]> {
  return (await scopedRead((tx) => tx.select().from(notificationTemplates).where(
    and(eq(notificationTemplates.tenantId, tenantId), isNull(notificationTemplates.supersededBy)),
  ).limit(limit))).map(toTemplateView);
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
    const preds = await scopedRead((tx) => tx.select().from(notificationTemplates).where(eq(notificationTemplates.supersededBy, current.id)).limit(1));
    if (!preds[0]) break;
    const pred = toTemplateView(preds[0]);
    versions.unshift(pred);
    current = pred;
  }
  return versions;
}

export async function findPrefsByUser(userId: string, limit = 200): Promise<PrefView[]> {
  return (await scopedRead((tx) => tx.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)).limit(limit))).map(toPrefView);
}

export async function findPrefsByTenant(tenantId: string, limit: number): Promise<PrefView[]> {
  return (await scopedRead((tx) => tx.select().from(notificationPrefs)
    .where(eq(notificationPrefs.tenantId, tenantId))
    .limit(limit))).map(toPrefView);
}

// Tenant-scoped single-pref read by row id (used to authorize an update — a
// wrong-tenant or unknown id resolves to null → 404, never another tenant's row).
export async function findPrefById(tenantId: string, id: string): Promise<PrefView | null> {
  const rows = await scopedRead((tx) => tx.select().from(notificationPrefs)
    .where(and(eq(notificationPrefs.id, id), eq(notificationPrefs.tenantId, tenantId)))
    .limit(1));
  return rows[0] ? toPrefView(rows[0]) : null;
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
      .set({
        inApp: row.inApp ?? true, email: row.email ?? true, push: row.push ?? false,
        // Tri-state: an omitted commercial channel clears the choice rather than
        // recording an opt-out the recipient never made.
        sms: row.sms ?? null, whatsapp: row.whatsapp ?? null,
        updatedBy: row.updatedBy, version: (existing[0]?.version ?? 0) + 1, updatedAt: new Date(),
      })
      .where(eq(notificationPrefs.id, existing[0]!.id));
  } else {
    await tx.insert(notificationPrefs).values(row);
  }
}

export async function findTemplateByIdTx(tx: Writer, id: string): Promise<TemplateView | null> {
  const rows = await tx.select().from(notificationTemplates).where(eq(notificationTemplates.id, id)).limit(1);
  return rows[0] ? toTemplateView(rows[0]) : null;
}

/** Update the status and approval-related fields of a template. Used by the approval workflow. */
export async function updateTemplateStatus(
  tx: Writer,
  templateId: string,
  newStatus: string,
  fields: {
    submittedBy?: string;
    submittedAt?: Date;
    approvedBy?: string;
    approvedAt?: Date;
    rejectionReason?: string;
    updatedBy: string;
  },
): Promise<void> {
  const set: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
    updatedBy: fields.updatedBy,
  };
  if (fields.submittedBy !== undefined) set.submittedBy = fields.submittedBy;
  if (fields.submittedAt !== undefined) set.submittedAt = fields.submittedAt;
  if (fields.approvedBy !== undefined) set.approvedBy = fields.approvedBy;
  if (fields.approvedAt !== undefined) set.approvedAt = fields.approvedAt;
  if (fields.rejectionReason !== undefined) set.rejectionReason = fields.rejectionReason;
  await tx.update(notificationTemplates).set(set).where(eq(notificationTemplates.id, templateId));
}

// Tenant-scoped channel update of an existing pref row by id. Only the provided
// channels are changed; the WHERE clause is bounded by tenantId so a forged id
// from another tenant updates nothing. Returns the count of rows changed.
export async function updatePrefsById(
  tx: Writer,
  tenantId: string,
  id: string,
  patch: {
    inApp?: boolean | undefined; email?: boolean | undefined; push?: boolean | undefined;
    // `null` withdraws a recorded commercial-channel choice; `undefined` leaves it.
    sms?: boolean | null | undefined; whatsapp?: boolean | null | undefined;
  },
  actorId: string,
): Promise<number> {
  const existing = await tx.select().from(notificationPrefs)
    .where(and(eq(notificationPrefs.id, id), eq(notificationPrefs.tenantId, tenantId)))
    .limit(1);
  if (!existing[0]) return 0;
  const set: Record<string, unknown> = { updatedBy: actorId, updatedAt: new Date(), version: existing[0].version + 1 };
  if (patch.inApp !== undefined) set.inApp = patch.inApp;
  if (patch.email !== undefined) set.email = patch.email;
  if (patch.push !== undefined) set.push = patch.push;
  if (patch.sms !== undefined) set.sms = patch.sms;
  if (patch.whatsapp !== undefined) set.whatsapp = patch.whatsapp;
  await tx.update(notificationPrefs).set(set)
    .where(and(eq(notificationPrefs.id, id), eq(notificationPrefs.tenantId, tenantId)));
  return 1;
}
