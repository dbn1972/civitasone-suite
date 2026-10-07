import { SkeletonBar, SkeletonRow } from "../../_components/ds/Skeleton";

/**
 * GAP-CDP-EVENTS-03 / IDENTITY-05 / SEGMENTS-04: one loading skeleton shared by
 * the CDP list routes (events, identity, segments). Each of those routes is a
 * ModuleListPage — a header plus a single records table, no stat cards — so the
 * skeleton mirrors exactly that: a heading bar matching the loaded "CDP — …"
 * title width, and a table skeleton. Uses the design-system Skeleton (theme
 * tokens via --line/--line2/--panel) rather than hard-coded #f1f5f9 blocks, so
 * there is no white flash in dark mode, and shows no stat-card row the page
 * never renders.
 */
export function CdpListLoading() {
  return (
    <div className="page-main">
      <div className="ph">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SkeletonBar w={220} h={28} />
          <SkeletonBar w={320} h={14} />
        </div>
      </div>
      <div aria-busy="true" aria-label="Loading…" style={{ marginTop: 16 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}
