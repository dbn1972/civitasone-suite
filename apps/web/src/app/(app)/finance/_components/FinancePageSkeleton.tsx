import { SkeletonBar, SkeletonCard } from "@/app/_components/ds/Skeleton";

/**
 * Page-shaped loading skeleton for finance cockpit screens (GAP-FINANCE-OPENING-
 * BALANCES-07 / PERIOD-CLOSE-07): header bars, `stats` stat-card placeholders, then
 * `blocks` full-width card placeholders (a form card, a table card, ...). One
 * `role="status"` region so assistive tech announces a single loading state.
 */
export function FinancePageSkeleton({
  stats,
  blocks,
  label = "Loading…",
}: {
  stats: number;
  /** Heights (px) of the card blocks under the stat row, top to bottom. */
  blocks: readonly number[];
  label?: string;
}) {
  return (
    <div className="page-main wrap" role="status" aria-live="polite" aria-label={label}>
      <div style={{ marginBottom: 24 }}>
        <SkeletonBar w={160} h={14} style={{ marginBottom: 12 }} />
        <SkeletonBar w={260} h={30} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${stats}, 1fr)`, gap: 16 }} data-testid="skeleton-stats">
        {Array.from({ length: stats }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      {blocks.map((h, i) => (
        <SkeletonBar key={i} h={h} style={{ marginTop: 18, borderRadius: 12 }} />
      ))}
    </div>
  );
}
