import { SkeletonBar } from "@/app/_components/ds";

/**
 * GAP-LIBRARY-HOME-04: the page renders a vertical list of full-width finding
 * cards (not a stat-card grid), preceded by a header, a search/severity filter
 * bar and a code legend. The skeleton now mirrors that exact shape — header +
 * toolbar + legend + 5 stacked full-width list-row placeholders — instead of
 * the former six-tile `grid g-3`, so the brief flash during route-chunk load
 * resembles the content that follows.
 */
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading…">
      {/* header */}
      <div className="ph" style={{ marginBottom: 16 }}>
        <SkeletonBar w={220} h={28} />
        <SkeletonBar w={340} h={16} style={{ marginTop: 8 }} />
      </div>

      {/* static-notice line */}
      <SkeletonBar w="60%" h={12} style={{ marginBottom: 18 }} />

      {/* search + severity filter toolbar */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <SkeletonBar w="100%" h={38} style={{ borderRadius: 6 }} />
        <SkeletonBar w="100%" h={38} style={{ borderRadius: 6 }} />
      </div>

      {/* legend line */}
      <SkeletonBar w="45%" h={12} style={{ marginBottom: 14 }} />

      {/* list of full-width finding-card placeholders */}
      <div style={{ display: "grid", gap: 12 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="card"
            aria-hidden="true"
            style={{ padding: 18, borderInlineStart: "4px solid var(--line)" }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <SkeletonBar w={34} h={18} style={{ borderRadius: 4 }} />
              <SkeletonBar w="45%" h={16} />
              <div style={{ marginInlineStart: "auto" }}>
                <SkeletonBar w={64} h={20} style={{ borderRadius: 99 }} />
              </div>
            </div>
            <SkeletonBar w="90%" h={13} style={{ marginBottom: 8 }} />
            <SkeletonBar w="30%" h={12} />
          </div>
        ))}
      </div>
    </div>
  );
}
