import type { PillVariant } from "@/app/_components/ds/StatusPill";

/**
 * One explicit vocabulary for platform service / process status, shared by the
 * super-admin dashboard and Tech Admin (GAP-ADMIN-TECH-ADMIN-02/-03,
 * GAP-ADMIN-SA-DASHBOARD-05). The shared StatusPill map has no running/stopped
 * keys (and is being changed by other open PRs), so these pages pass an
 * explicit `variant` instead of relying on that map. PM2 reports
 * online/stopped/errored; the health feed has used running/stopped/degraded.
 * Anything outside this set is "unknown" -- never silently counted as degraded.
 */
export type ServiceBucket = "up" | "degraded" | "down" | "unknown";

const UP = new Set(["running", "online", "healthy", "ok", "operational", "up"]);
const DEGRADED = new Set(["degraded", "warning", "slow", "partial"]);
const DOWN = new Set(["stopped", "stopping", "errored", "error", "down", "offline", "unhealthy", "critical", "failed", "crashed"]);

function norm(status: unknown): string {
  return String(status ?? "").replace(/[_-]+/g, " ").trim().toLowerCase();
}

export function serviceBucket(status: unknown): ServiceBucket {
  const s = norm(status);
  if (UP.has(s)) return "up";
  if (DEGRADED.has(s)) return "degraded";
  if (DOWN.has(s)) return "down";
  return "unknown";
}

const TONE: Record<ServiceBucket, PillVariant> = { up: "good", degraded: "warn", down: "bad", unknown: "mut" };

export function serviceStatusTone(status: unknown): PillVariant {
  return TONE[serviceBucket(status)];
}

export function countServiceBuckets(rows: ReadonlyArray<{ status?: unknown }>): Record<ServiceBucket, number> {
  const out: Record<ServiceBucket, number> = { up: 0, degraded: 0, down: 0, unknown: 0 };
  for (const r of rows) out[serviceBucket(r.status)]++;
  return out;
}

/** Tenant lifecycle tone (GAP-ADMIN-TENANTS-02): trial is amber, suspended red, active green. */
export function tenantStatusTone(status: unknown): PillVariant {
  switch (norm(status)) {
    case "active": return "good";
    case "trial": case "pending": case "onboarding": return "warn";
    case "suspended": case "terminated": case "cancelled": return "bad";
    case "inactive": case "archived": case "expired": return "mut";
    default: return "info";
  }
}

/**
 * Explicit pill tone for a status word in the service vocabulary, or undefined
 * when the word is not one of ours (so the shared StatusPill map decides, e.g.
 * for active/pending/failed which it already colours correctly).
 */
export function knownServiceTone(status: unknown): PillVariant | undefined {
  const b = serviceBucket(status);
  return b === "unknown" ? undefined : TONE[b];
}
