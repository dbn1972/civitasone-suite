import { normStatus, str } from "../_components/status";
import type { PillVariant } from "@/app/_components/ds/StatusPill";

/**
 * GET /v1/admin/onboarding rows. No service in the current tree serves this
 * path, so the stage vocabulary below is the page's long-standing one, kept as
 * explicit allow-lists (GAP-ADMIN-ONBOARDING-04) rather than "everything else".
 */
export type OnboardingRow = {
  /** Request id; empty when the API row carries none (then no provisioning link is offered). */
  id: string;
  org: string;
  contact: string;
  requested: string;
  assigned: string;
  stage: string;
};

export function toOnboardingRows(raw: Record<string, unknown>[]): OnboardingRow[] {
  return raw.map((r) => ({
    id: str(r.id),
    org: str(r.org),
    contact: str(r.contact),
    requested: str(r.requested),
    assigned: str(r.assigned),
    stage: str(r.stage),
  }));
}

const NEW = "new request";
const READY = "go-live pending"; // normStatus form: "go live pending"
const ACTIVE = new Set(["in progress", "provisioning", "configuring", "configuration", "under review", "verification", "kyc review"]);
const CLOSED = new Set(["completed", "rejected", "cancelled", "canceled"]);

/** GAP-ADMIN-ONBOARDING-07: where an open request is actioned. Closed or id-less rows have no link. */
export function provisioningHref(r: Pick<OnboardingRow, "id" | "stage">): string | null {
  if (!r.id || CLOSED.has(normStatus(r.stage))) return null;
  return `/admin/tenant-provision?requestId=${encodeURIComponent(r.id)}`;
}

export function onboardingStats(rows: OnboardingRow[]) {
  let newReqs = 0, ready = 0, inProgress = 0, inQueue = 0, other = 0;
  for (const r of rows) {
    const s = normStatus(r.stage);
    if (CLOSED.has(s)) continue; // completed/rejected/cancelled are not "in the queue"
    inQueue++;
    if (s === NEW) newReqs++;
    else if (s === normStatus(READY)) ready++;
    else if (ACTIVE.has(s)) inProgress++;
    else other++; // blocked / unknown stage: surfaced, never folded into In Progress
  }
  return { inQueue, newReqs, inProgress, ready, other };
}

// GAP-ADMIN-ONBOARDING-06: tones for the stages this page actually uses.
const TONES: Record<string, PillVariant> = {
  [NEW]: "info",
  [normStatus(READY)]: "warn",
  "in progress": "warn",
  completed: "good",
  rejected: "bad",
  cancelled: "mut",
  blocked: "bad",
};
export function onboardingStageTone(stage: string): PillVariant {
  return TONES[normStatus(stage)] ?? "info";
}
