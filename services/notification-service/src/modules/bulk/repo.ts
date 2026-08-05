import { and, desc, eq, sql } from "drizzle-orm";
import { db, scopedRead, readScoped } from "../../shared/db.js";
import {
  notificationCampaigns,
  notificationCampaignRecipients,
  notificationCampaignResponses,
  type CampaignInsert,
} from "./schema.js";
import type {
  CampaignView,
  CampaignRecipientView,
  CampaignListResult,
  CampaignMetrics,
  CampaignResponseView,
} from "./domain.js";
import { computeRoiBps } from "./domain.js";

/** bigint columns come back as JS bigint (mode: "bigint"); serialise as string. */
function money(v: bigint | number | string | null | undefined): string {
  return (v ?? 0n).toString();
}

function toCampaignView(
  r: typeof notificationCampaigns.$inferSelect,
  stats?: { recipientCount: number; deliveredCount: number },
): CampaignView {
  return {
    id: r.id, tenantId: r.tenantId, templateId: r.templateId, name: r.name,
    status: r.status,
    scheduledAt: r.scheduledAt instanceof Date ? r.scheduledAt.toISOString() : r.scheduledAt ?? null,
    objective: r.objective ?? null,
    audienceSegmentId: r.audienceSegmentId ?? null,
    budgetMinor: money(r.budgetMinor),
    currency: r.currency,
    actualCostMinor: money(r.actualCostMinor),
    version: r.version,
    ...(stats ? { recipientCount: stats.recipientCount, deliveredCount: stats.deliveredCount } : {}),
  };
}

function toResponseView(r: typeof notificationCampaignResponses.$inferSelect): CampaignResponseView {
  return {
    id: r.id, campaignId: r.campaignId, subjectType: r.subjectType, subjectId: r.subjectId,
    responded: r.responded, converted: r.converted, revenueMinor: money(r.revenueMinor),
    respondedAt: r.respondedAt instanceof Date ? r.respondedAt.toISOString() : String(r.respondedAt),
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

/**
 * R1: the consent gate refused this recipient, so no send command is published
 * for them. The row stays in the campaign (the operator must be able to see who
 * was excluded and why) but is terminal at `skipped`.
 */
export async function markRecipientSkipped(tx: Writer, id: string, actorId: string): Promise<void> {
  await tx.update(notificationCampaignRecipients).set({
    status: "skipped", updatedBy: actorId, updatedAt: new Date(),
  }).where(eq(notificationCampaignRecipients.id, id));
}

/**
 * MK-004 metrics truth: propagate a per-message delivery OUTCOME back onto the
 * campaign_recipients row. Without this the recipient status is frozen at
 * 'queued'/'skipped' from the fan-out and the metrics delivered/failed counters
 * are always 0 — the real outcome lives in deliveries.deliveries, set by the
 * deliveries consumer. That consumer calls this in the SAME tenant-scoped tx
 * when it finalizes a delivery, matching on the (tenant, campaign, recipient)
 * natural key the fan-out carries.
 *
 * Idempotent: re-writing the same terminal status is a harmless no-op update.
 * RLS-scoped: runs inside the message's tenant transaction and is also
 * tenant-guarded in the WHERE. `delivery_id` is written back so the campaign
 * recipient can be joined to its delivery for drill-down.
 */
export async function syncCampaignRecipientOutcome(
  tx: Writer,
  tenantId: string,
  campaignId: string,
  recipientId: string,
  status: string,
  deliveryId: string | null,
  actorId: string,
): Promise<void> {
  await tx.update(notificationCampaignRecipients).set({
    status,
    ...(deliveryId ? { deliveryId } : {}),
    updatedBy: actorId,
    updatedAt: new Date(),
  }).where(and(
    eq(notificationCampaignRecipients.tenantId, tenantId),
    eq(notificationCampaignRecipients.campaignId, campaignId),
    eq(notificationCampaignRecipients.recipientId, recipientId),
  ));
}

/* ── MK-001/MK-004 marketing reads/writes ─────────────────────────────────── */

/**
 * MK-001: paginated, tenant-scoped campaign list. readScoped establishes the
 * tenant context itself so RLS is enforced even on a direct (non-request) call.
 */
export async function listCampaigns(tenantId: string, limit: number, offset: number): Promise<CampaignListResult> {
  return readScoped(tenantId, async (tx) => {
    const rows = await tx.select().from(notificationCampaigns)
      .orderBy(desc(notificationCampaigns.createdAt))
      .limit(limit).offset(offset);
    const totalRows = await tx.select({ value: sql<number>`count(*)::int` }).from(notificationCampaigns);
    const total = totalRows[0]?.value ?? 0;
    const campaigns = rows.map((r) => ({
      id: r.id,
      name: r.name,
      objective: r.objective ?? null,
      status: r.status,
      budgetMinor: money(r.budgetMinor),
      currency: r.currency,
      audienceSegmentId: r.audienceSegmentId ?? null,
      scheduledAt: r.scheduledAt instanceof Date ? r.scheduledAt.toISOString() : r.scheduledAt ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }));
    return { campaigns, total };
  });
}

/**
 * MK-004: server-side campaign metrics. Every number is computed from the DB
 * (never trusted from the client). delivered/failed derive from the campaign
 * recipient status vocabulary; attributed revenue is SUM(revenue_minor) in
 * BigInt; ROI is basis points computed in integer arithmetic (null if cost = 0).
 */
export async function getCampaignMetrics(tenantId: string, campaignId: string): Promise<CampaignMetrics | null> {
  return readScoped(tenantId, async (tx) => {
    const camp = await tx.select().from(notificationCampaigns)
      .where(eq(notificationCampaigns.id, campaignId)).limit(1);
    if (!camp[0]) return null;

    const recip = await tx.select({
      total:     sql<number>`count(*)::int`,
      delivered: sql<number>`count(*) filter (where status in ('delivered','sent'))::int`,
      failed:    sql<number>`count(*) filter (where status = 'failed')::int`,
    }).from(notificationCampaignRecipients)
      .where(eq(notificationCampaignRecipients.campaignId, campaignId));

    const resp = await tx.select({
      responses:   sql<number>`count(*) filter (where responded)::int`,
      conversions: sql<number>`count(*) filter (where converted)::int`,
      // Money SUM as text → BigInt: integer arithmetic only, no float.
      revenue:     sql<string>`coalesce(sum(revenue_minor) filter (where responded), 0)::text`,
    }).from(notificationCampaignResponses)
      .where(eq(notificationCampaignResponses.campaignId, campaignId));

    const attributedRevenueMinor = BigInt(resp[0]?.revenue ?? "0");
    const actualCostMinor = camp[0].actualCostMinor ?? 0n;

    return {
      campaignId,
      recipients:  recip[0]?.total ?? 0,
      delivered:   recip[0]?.delivered ?? 0,
      failed:      recip[0]?.failed ?? 0,
      responses:   resp[0]?.responses ?? 0,
      conversions: resp[0]?.conversions ?? 0,
      budgetMinor:            money(camp[0].budgetMinor),
      actualCostMinor:        money(actualCostMinor),
      attributedRevenueMinor: attributedRevenueMinor.toString(),
      roiBps:  computeRoiBps(attributedRevenueMinor, actualCostMinor),
      currency: camp[0].currency,
    };
  });
}

/**
 * MK-004: record/attribute a response. Upserts on the (tenant, campaign,
 * subject_type, subject_id) unique key so the same subject is never
 * double-counted. Returns null if the campaign does not exist for this tenant
 * (RLS-scoped). revenueMinor is bigint paise.
 */
export async function upsertCampaignResponse(
  tenantId: string,
  input: { campaignId: string; subjectType: string; subjectId: string; converted: boolean; revenueMinor: string },
  actorId: string,
): Promise<CampaignResponseView | null> {
  return readScoped(tenantId, async (tx) => {
    const camp = await tx.select({ id: notificationCampaigns.id }).from(notificationCampaigns)
      .where(eq(notificationCampaigns.id, input.campaignId)).limit(1);
    if (!camp[0]) return null;

    const revenue = BigInt(input.revenueMinor);
    const rows = await tx.insert(notificationCampaignResponses).values({
      tenantId, campaignId: input.campaignId, subjectType: input.subjectType, subjectId: input.subjectId,
      responded: true, converted: input.converted, revenueMinor: revenue,
      createdBy: actorId, updatedBy: actorId,
    }).onConflictDoUpdate({
      target: [
        notificationCampaignResponses.tenantId,
        notificationCampaignResponses.campaignId,
        notificationCampaignResponses.subjectType,
        notificationCampaignResponses.subjectId,
      ],
      set: {
        responded: true,
        converted: input.converted,
        revenueMinor: revenue,
        respondedAt: new Date(),
        updatedBy: actorId,
        updatedAt: new Date(),
        version: sql`${notificationCampaignResponses.version} + 1`,
      },
    }).returning();
    return rows[0] ? toResponseView(rows[0]) : null;
  });
}
