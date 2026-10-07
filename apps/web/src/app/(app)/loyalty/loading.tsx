import { SkeletonBar, SkeletonCard } from "../../_components/ds";

/**
 * GAP-LOYALTY-HOME-04 / HOME-01: the loading skeleton now uses the ds Skeleton
 * primitives (token-driven, so dark mode is handled — no bg-slate-50 /
 * bg-gray-200 light-only literals, no min-h-screen full-height block nested in
 * the app shell). It mirrors the loaded hub: header + 3 stat cards + a 4-up
 * tile grid, so there is no layout jump when data arrives.
 */
export default function LoyaltyLoading() {
  return (
    <div className="page-main" aria-busy="true" aria-label="Loading loyalty hub…">
      {/* header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        <SkeletonBar w={200} h={28} />
        <SkeletonBar w={320} h={14} />
      </div>
      {/* 3 stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 20 }}>
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      {/* 4-up tile grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{ height: 96, borderRadius: 12, background: "var(--line2)" }} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}
