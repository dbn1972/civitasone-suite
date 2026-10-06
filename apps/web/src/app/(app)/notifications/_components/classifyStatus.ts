/**
 * GAP-NOTIFICATIONS-LIST-02: a single, shared classification of a notification
 * event's delivery status into the buckets the inbox stat tiles and the
 * "Unread" tab use. Previously the list page defined "Unread" as
 * `status !== "read"`, which silently counted FAILED and QUEUED events as
 * unread, and the stat tiles matched only sent/failed/read so delivered/pending/
 * queued fell into no tile but still inflated Total.
 *
 * Buckets (every status maps to exactly one, so the tiles sum to the total):
 *  - "delivered": the message reached the recipient (sent | delivered | read)
 *  - "failed":    terminal failure (failed | bounced | cancelled)
 *  - "inProgress": not yet terminal (queued | pending | sending | anything else)
 *
 * "read" is a sub-state of delivered (you can only read what was delivered), so
 * it counts under delivered here; the separate "read" count is tracked by the
 * caller from the raw status where a real read flag exists.
 */
export type NotifBucket = "delivered" | "failed" | "inProgress";

const DELIVERED = new Set(["sent", "delivered", "read"]);
const FAILED = new Set(["failed", "bounced", "cancelled"]);

export function classifyStatus(status: string | null | undefined): NotifBucket {
  const key = String(status ?? "").trim().toLowerCase();
  if (DELIVERED.has(key)) return "delivered";
  if (FAILED.has(key)) return "failed";
  return "inProgress";
}

/** True when an event should appear under the "Unread" tab: delivered to the
 * recipient but not yet read. Failed and in-progress events are NOT unread. */
export function isUnread(status: string | null | undefined): boolean {
  const key = String(status ?? "").trim().toLowerCase();
  return DELIVERED.has(key) && key !== "read";
}

/** Tile counts that always sum to `statuses.length`. */
export function bucketCounts(statuses: readonly (string | null | undefined)[]): {
  total: number;
  delivered: number;
  failed: number;
  inProgress: number;
  read: number;
  unread: number;
} {
  let delivered = 0, failed = 0, inProgress = 0, read = 0, unread = 0;
  for (const s of statuses) {
    const bucket = classifyStatus(s);
    if (bucket === "delivered") delivered += 1;
    else if (bucket === "failed") failed += 1;
    else inProgress += 1;
    if (String(s ?? "").trim().toLowerCase() === "read") read += 1;
    if (isUnread(s)) unread += 1;
  }
  return { total: statuses.length, delivered, failed, inProgress, read, unread };
}
