/**
 * G17 — Due-horizon work-queue generator: pure domain logic.
 *
 * All functions are side-effect-free and testable in isolation.
 * They compute horizon windows, filter subscriptions, and group items
 * for batch work-queue generation.
 */

export interface HorizonWindow {
  from: Date;
  to: Date;
}

/**
 * Compute the date range for subscriptions whose next_due_date falls
 * within `horizonDays` of `now`. The window starts at `now` and ends
 * exactly `horizonDays` calendar days from `now` (inclusive).
 */
export function computeHorizonWindow(now: Date, horizonDays: number): HorizonWindow {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);

  const to = new Date(from);
  to.setDate(to.getDate() + horizonDays);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

export interface SubscriptionItem {
  id: string;
  contactId: string;
  productId: string;
  amountMinor: bigint;
  frequency: string;
  status: string;
  nextDueDate: string | null;
  /** Optional fields used for grouping */
  ownerId?: string | null;
  region?: string | null;
  consentGiven?: boolean;
}

export interface HorizonConfig {
  consentRequired: boolean;
  groupBy: "product" | "region" | "owner";
  active: boolean;
}

/**
 * Determine whether a subscription should be included in the work queue.
 * Checks: subscription must be active, and if consent is required by config
 * the subscription must have consent.
 */
export function shouldInclude(subscription: SubscriptionItem, config: HorizonConfig): boolean {
  if (subscription.status !== "active") return false;
  if (config.consentRequired && subscription.consentGiven === false) return false;
  return true;
}

export interface WorkQueueItem {
  subscriptionId: string;
  contactId: string;
  productId: string;
  amountMinor: bigint;
  frequency: string;
  nextDueDate: string;
}

/**
 * Group items by the configured dimension (product, region, or owner).
 * Returns a Map keyed by the group identifier with arrays of items.
 */
export function groupItems(
  items: WorkQueueItem[],
  groupBy: "product" | "region" | "owner",
  subscriptions: SubscriptionItem[],
): Map<string, WorkQueueItem[]> {
  const lookup = new Map<string, SubscriptionItem>();
  for (const s of subscriptions) {
    lookup.set(s.id, s);
  }

  const grouped = new Map<string, WorkQueueItem[]>();

  for (const item of items) {
    const sub = lookup.get(item.subscriptionId);
    let key: string;

    switch (groupBy) {
      case "product":
        key = item.productId;
        break;
      case "region":
        key = sub?.region ?? "unassigned";
        break;
      case "owner":
        key = sub?.ownerId ?? "unassigned";
        break;
      default:
        key = item.productId;
    }

    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }

  return grouped;
}

/**
 * Given a list of subscriptions and a horizon window, produce the work-queue
 * items — subscriptions whose next_due_date falls within the window.
 */
export function filterByWindow(
  subscriptions: SubscriptionItem[],
  window: HorizonWindow,
  config: HorizonConfig,
): WorkQueueItem[] {
  const results: WorkQueueItem[] = [];

  for (const sub of subscriptions) {
    if (!shouldInclude(sub, config)) continue;
    if (!sub.nextDueDate) continue;

    const dueDate = new Date(sub.nextDueDate);
    if (dueDate >= window.from && dueDate <= window.to) {
      results.push({
        subscriptionId: sub.id,
        contactId: sub.contactId,
        productId: sub.productId,
        amountMinor: sub.amountMinor,
        frequency: sub.frequency,
        nextDueDate: sub.nextDueDate,
      });
    }
  }

  return results;
}

/** Valid groupBy values — exported for validators. */
export const GROUP_BY_VALUES = ["product", "region", "owner"] as const;
export type GroupByValue = (typeof GROUP_BY_VALUES)[number];
