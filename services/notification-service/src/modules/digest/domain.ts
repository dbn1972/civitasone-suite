/**
 * Digest domain logic — pure functions for digest accumulation decisions.
 */

import type { PriorityLevel } from "../priority/types.js";

export type DigestRule = {
  eventType: string;
  channel: string;
  accumulationWindowMinutes: number;
  maxBatchSize: number;
  digestTemplateId: string;
  enabled: boolean;
};

/**
 * Returns true if the notification should be accumulated into a digest bucket.
 * A rule must exist and priority must not be critical.
 */
export function shouldAccumulate(rule: DigestRule | null, priority: PriorityLevel): boolean {
  if (!rule) return false;
  if (priority === "critical") return false;
  return true;
}

/**
 * Returns true if the digest window has expired (now >= openedAt + windowMinutes).
 */
export function isWindowExpired(openedAt: Date | string, windowMinutes: number, now: Date = new Date()): boolean {
  const opened = typeof openedAt === "string" ? new Date(openedAt) : openedAt;
  const expiresAt = new Date(opened.getTime() + windowMinutes * 60_000);
  return now.getTime() >= expiresAt.getTime();
}

/**
 * Returns true if the bucket has reached or exceeded the max batch size.
 */
export function shouldFlushBySize(itemCount: number, maxBatchSize: number): boolean {
  return itemCount >= maxBatchSize;
}
