import { SkeletonBar, SkeletonCard } from "../../../_components/ds";

/**
 * Loading skeleton for a single module guide. Mirrors the real layout
 * (GAP-HELP-HOME-05 / GAP-HELP-MODULE-04): a header, the "Open module" button,
 * then two task cards — no stat-card row, which this page never shows.
 */
export default function Loading() {
  return (
    <section className="page-main wrap" aria-label="Loading guide">
      <div aria-busy="true" className="animate-pulse space-y-4">
        {/* back link + heading */}
        <SkeletonBar w={110} h={12} />
        <SkeletonBar w={220} h={28} />
        <SkeletonBar w={320} h={14} />
        {/* "Open module" button */}
        <SkeletonBar w={160} h={38} style={{ borderRadius: 10 }} />
        {/* two task cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 12,
            marginTop: 8,
          }}
        >
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </section>
  );
}
