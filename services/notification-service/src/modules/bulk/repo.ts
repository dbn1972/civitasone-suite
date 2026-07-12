import { eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { notificationCampaigns, notificationCampaignRecipients, type CampaignInsert } from "./schema.js";
import type { CampaignView, CampaignRecipientView } from "./domain.js";

function toCampaignView(r: typeof notificationCampaigns.$inferSelect, stats?: { recipientCount: number; deliveredCount: number }): CampaignView {
  return {
    id: r.id, tenantId: r.tenantId, templateId: r.templateId, name: r.name,
    status: r.status, scheduledAt: r.scheduledAt instanceof Date ? r.scheduledAt.toISOString() : r.scheduledAt ?? null, version: r.version,
    ...(stats ? { recipientCount: stats.recipientCount, deliveredCount: stats.deliveredCount } : {}),
  };
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findCampaignById(id: string): Promise<CampaignView | null> {
  const rows = await scopedRead((tx) => tx.select().from(notificationCampaigns).where(eq(notificationCampaigns.id, id)).limit(1));
  if (!rows[0]) return null;
  const recipients = await scopedRead((tx) => tx.select().from(notificationCampaignRecipients).where(eq(notificationCampaignRecipients.campaignId, id)).limit(500));
  const deliveredCount = recipients.filter((r) => r.status === "delivered" || r.status === "sent").length;
  return toCampaignView(rows[0], { recipientCount: recipients.length, deliveredCount });
}

export async function insertCampaign(tx: Writer, row: CampaignInsert, recipientIds: string[]): Promise<void> {
  await tx.insert(notificationCampaigns).values(row);
  for (const recipientId of recipientIds) {
    await tx.insert(notificationCampaignRecipients).values({
      tenantId: row.tenantId!, campaignId: row.id!, recipientId,
      status: "pending", createdBy: row.createdBy!, updatedBy: row.updatedBy!,
    });
  }
}

export async function findRecipientsByCampaign(tx: Writer, campaignId: string, limit = 500): Promise<CampaignRecipientView[]> {
  const rows = await tx.select().from(notificationCampaignRecipients).where(eq(notificationCampaignRecipients.campaignId, campaignId)).limit(limit);
  return rows.map((r) => ({ id: r.id, campaignId: r.campaignId, recipientId: r.recipientId, status: r.status, deliveryId: r.deliveryId }));
}

export async function updateCampaignStatus(tx: Writer, id: string, status: string, actorId: string): Promise<void> {
  const rows = await tx.select().from(notificationCampaigns).where(eq(notificationCampaigns.id, id)).limit(1);
  const current = rows[0];
  if (!current) return;
  await tx.update(notificationCampaigns).set({
    status, updatedBy: actorId, updatedAt: new Date(), version: current.version + 1,
  }).where(eq(notificationCampaigns.id, id));
}

export async function markRecipientQueued(tx: Writer, id: string, actorId: string): Promise<void> {
  await tx.update(notificationCampaignRecipients).set({
    status: "queued", updatedBy: actorId, updatedAt: new Date(),
  }).where(eq(notificationCampaignRecipients.id, id));
}
