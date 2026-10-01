import { SkeletonBar, SkeletonCard, SkeletonRow } from "../../../_components/ds";

/**
 * GAP-HR-DASHBOARD-09: mirrors the real page's layout end-to-end (greeting
 * banner area, 6-card KPI strip, 3-column body, employee-table rows) with NO
 * visible title. The real page (page.tsx) only ever renders an sr-only
 * <h1> -- the previous version of this file rendered a VISIBLE
 * `<PageHeader title="HR Dashboard".../>` that then disappeared the instant
 * real data arrived, a header pop-in/out on every single load. Built from
 * the same generic shimmer primitives (SkeletonBar/SkeletonCard/SkeletonRow)
 * the rest of the app already uses, rather than the more opinionated
 * SkeletonTable (which bakes in its own 4 stat cards + filter toolbar that
 * don't exist anywhere on this real page and would themselves be a
 * different pop-in/out mismatch).
 */
export default function HRDashboardLoading() {
  return (
    <div style={{ background: "var(--page-bg,#eef2f7)", minHeight: "100vh" }}>
      {/* Greeting-header-shaped placeholder -- no visible text. */}
      <div aria-hidden="true" style={{ padding: "20px 24px 34px", display: "flex", flexDirection: "column", gap: 10 }}>
        <SkeletonBar w="220px" h={12} />
        <SkeletonBar w="180px" h={22} />
      </div>

      {/* KPI strip skeleton -- 6 cards matching HRKPIStrip's own grid. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, padding: "0 24px 14px" }}>
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>

      {/* 3-column body skeleton -- action inbox / dept chart / quick actions. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px 220px", gap: 12, padding: "0 24px 12px" }}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>

      {/* Employee table skeleton. */}
      <div style={{ margin: "0 24px 32px", background: "var(--panel,#fff)", borderRadius: 8, padding: "4px 16px" }}>
        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    </div>
  );
}
