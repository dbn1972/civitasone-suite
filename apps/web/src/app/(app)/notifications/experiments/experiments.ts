import type { NotificationExperiment } from "@civitasone/types";

export function needsApproval(status: string): boolean {
  return status === "pending_approval";
}

export function statusLabel(status: string): string {
  switch (status) {
    case "pending_approval":
      return "Awaiting winner approval";
    case "running":
      return "Running";
    case "concluded":
      return "Concluded";
    case "draft":
      return "Draft";
    default:
      return status;
  }
}

/**
 * GAP-NOTIFICATIONS-EXPERIMENTS-04: a human-readable winner cell for the
 * experiments table. Approvers need to see WHICH variant won and by HOW MUCH,
 * not an opaque uuid.
 *
 * The list endpoint returns `winnerVariantKey` (the short variant key, e.g.
 * "B") when a winner is set, plus `winnerMarginPct`. The margin is a
 * CLICK-RATE margin in percentage points (see experiments/domain.ts
 * determineWinner — it is NOT an open-rate figure), so it is labelled as such
 * and never dressed up as statistical significance.
 *
 * When no winner is set we show "—" (not a fabricated id). When a winner id is
 * present but its key could not be resolved we fall back to the short id so the
 * cell is never blank, and we only append the margin when it is a real number.
 */
export function experimentWinnerDisplay(e: NotificationExperiment): string {
  const label = e.winnerVariantKey?.trim()
    ? `Variant ${e.winnerVariantKey.trim()}`
    : e.winnerVariantId
      ? e.winnerVariantId.slice(0, 8)
      : null;
  if (!label) return "—";
  if (typeof e.winnerMarginPct === "number" && Number.isFinite(e.winnerMarginPct)) {
    return `${label} (+${e.winnerMarginPct}% click-rate margin)`;
  }
  return label;
}

export function rankExperiments(rows: NotificationExperiment[]): NotificationExperiment[] {
  const order: Record<string, number> = { pending_approval: 0, running: 1, draft: 2, concluded: 3 };
  return [...rows].sort((a, b) => {
    const ao = order[a.status] ?? 9;
    const bo = order[b.status] ?? 9;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
}
