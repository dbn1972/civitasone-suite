/**
 * CH-14 channel analytics — real counts.
 *
 * DOM-015: `channels/analytics-routes.ts` used to hand back a hardcoded
 * all-zero object as a plain 200 for both endpoints below — indistinguishable
 * from a tenant that genuinely has zero delivery/engagement activity. The
 * tables it claimed weren't wired yet already exist and are already written
 * by real code paths:
 *   - `analytics.open_events` / `click_events` — written by
 *     `modules/analytics/consumer.ts` from the real tracking pixel and click
 *     redirect in `modules/analytics/routes.ts`.
 *   - `deliveries.deliveries` — every send, with a real terminal `status`.
 *     NOTE: `chk_deliveries_status` only allows
 *     `queued|sending|delivered|failed|skipped|read` — bounces are NEVER
 *     written to this column (an earlier draft of this fix assumed
 *     `status = 'bounced'` and the CHECK constraint caught it in testing).
 *     Real bounces live in `bounces.bounce_events` (INT-12), keyed by
 *     `delivery_id`.
 *   - `bulk.campaigns` / `campaign_recipients` — real campaigns, and (per
 *     recipient) the delivery each one resolved to, mirrored onto
 *     `campaign_recipients.delivery_id`/`status` by
 *     `modules/deliveries/consumer.ts`'s `mirrorCampaignOutcome` (the same
 *     fix already applied once for MK-004's `bulk/repo.ts#getCampaignMetrics`
 *     — "so the campaign metrics query counts real delivered/failed numbers
 *     instead of frozen zeros". This is that same pattern, for CH-14.
 *   - `notification.conversations` — real conversation threads.
 *
 * This intentionally does NOT read `analytics.delivery_metrics` (the
 * pre-aggregated rollup `analytics/repo.ts#getAggregateMetrics` queries) —
 * nothing populates that rollup table yet, so it would just be a different
 * shade of the same "always empty" problem. Counting the raw event/delivery
 * tables directly is real today, even though it won't scale forever.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { readScoped } from "../../shared/db.js";
import { openEvents, clickEvents } from "../analytics/schema.js";
import { notificationDeliveries } from "../deliveries/schema.js";
import { notificationCampaigns, notificationCampaignRecipients } from "../bulk/schema.js";
import { conversations } from "../conversations/schema.js";
import { bounceEvents } from "../bounces/schema.js";

export interface ChannelAnalyticsSummary {
  totalDelivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  campaignCount: number;
  conversationCount: number;
}

export interface CampaignChannelMetrics {
  campaignId: string;
  totalDelivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  failed: number;
}

/** Tenant-wide delivery/engagement summary (CH-14). Every field is a real COUNT. */
export async function getChannelAnalyticsSummary(tenantId: string): Promise<ChannelAnalyticsSummary> {
  return readScoped(tenantId, async (tx) => {
    const delivered = await tx.select({ n: sql<number>`count(*)::int` }).from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.tenantId, tenantId), eq(notificationDeliveries.status, "delivered")));
    const bounced = await tx.select({ n: sql<number>`count(*)::int` }).from(bounceEvents)
      .where(eq(bounceEvents.tenantId, tenantId));
    const opened = await tx.select({ n: sql<number>`count(*)::int` }).from(openEvents)
      .where(eq(openEvents.tenantId, tenantId));
    const clicked = await tx.select({ n: sql<number>`count(*)::int` }).from(clickEvents)
      .where(eq(clickEvents.tenantId, tenantId));
    const campaigns = await tx.select({ n: sql<number>`count(*)::int` }).from(notificationCampaigns)
      .where(eq(notificationCampaigns.tenantId, tenantId));
    const convos = await tx.select({ n: sql<number>`count(*)::int` }).from(conversations)
      .where(eq(conversations.tenantId, tenantId));

    return {
      totalDelivered: delivered[0]?.n ?? 0,
      opened: opened[0]?.n ?? 0,
      clicked: clicked[0]?.n ?? 0,
      bounced: bounced[0]?.n ?? 0,
      campaignCount: campaigns[0]?.n ?? 0,
      conversationCount: convos[0]?.n ?? 0,
    };
  });
}

/**
 * Per-campaign delivery/engagement metrics (CH-14). Returns `null` when the
 * campaign does not exist for this tenant, so the route can 404 instead of
 * (as before) returning identical all-zero "metrics" for a made-up id.
 */
export async function getCampaignChannelMetrics(tenantId: string, campaignId: string): Promise<CampaignChannelMetrics | null> {
  return readScoped(tenantId, async (tx) => {
    const camp = await tx.select({ id: notificationCampaigns.id }).from(notificationCampaigns)
      .where(and(eq(notificationCampaigns.id, campaignId), eq(notificationCampaigns.tenantId, tenantId)))
      .limit(1);
    if (!camp[0]) return null;

    const recip = await tx.select({
      delivered: sql<number>`count(*) filter (where status = 'delivered')::int`,
      failed:    sql<number>`count(*) filter (where status = 'failed')::int`,
    }).from(notificationCampaignRecipients)
      .where(and(
        eq(notificationCampaignRecipients.campaignId, campaignId),
        eq(notificationCampaignRecipients.tenantId, tenantId),
      ));

    // The real deliveries this campaign's recipients resolved to — the join
    // key onto the analytics event tables (opens/clicks) and bounce_events
    // (bounces). A recipient not yet sent has a null delivery_id.
    const deliveryIdRows = await tx.select({ deliveryId: notificationCampaignRecipients.deliveryId })
      .from(notificationCampaignRecipients)
      .where(and(
        eq(notificationCampaignRecipients.campaignId, campaignId),
        eq(notificationCampaignRecipients.tenantId, tenantId),
      ));
    const deliveryIds = deliveryIdRows.map((r) => r.deliveryId).filter((v): v is string => v !== null);

    const base = { campaignId, totalDelivered: recip[0]?.delivered ?? 0, failed: recip[0]?.failed ?? 0 };
    if (deliveryIds.length === 0) {
      return { ...base, opened: 0, clicked: 0, bounced: 0 };
    }

    const bounced = await tx.select({ n: sql<number>`count(*)::int` }).from(bounceEvents)
      .where(and(eq(bounceEvents.tenantId, tenantId), inArray(bounceEvents.deliveryId, deliveryIds)));
    const opened = await tx.select({ n: sql<number>`count(*)::int` }).from(openEvents)
      .where(and(eq(openEvents.tenantId, tenantId), inArray(openEvents.deliveryId, deliveryIds)));
    const clicked = await tx.select({ n: sql<number>`count(*)::int` }).from(clickEvents)
      .where(and(eq(clickEvents.tenantId, tenantId), inArray(clickEvents.deliveryId, deliveryIds)));

    return { ...base, opened: opened[0]?.n ?? 0, clicked: clicked[0]?.n ?? 0, bounced: bounced[0]?.n ?? 0 };
  });
}
