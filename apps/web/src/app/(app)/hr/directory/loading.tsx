import { SkeletonBar, SkeletonCard } from "../../../_components/ds/Skeleton";

// GAP-HR-DIRECTORY-07: was a single bare skeleton div with no header, stat
// row or card shape, so the loaded layout visibly jumps into place. Mirrors
// the real page's own structure (PageHeader, 4 StatCards, a toolbar bar,
// then a grid of employee-card-shaped blocks) using the shared Skeleton
// primitives every other HRMS page's loading.tsx already uses.
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" role="status">
      <span className="sr-only">Loading employee directory…</span>
      <div style={{ marginBottom: 14 }}>
        <SkeletonBar w="220px" h={26} />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <SkeletonBar w="100%" h={44} style={{ flex: 1, maxWidth: 320, borderRadius: 6 }} />
        <SkeletonBar w={140} h={44} style={{ borderRadius: 6 }} />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 14,
        }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            style={{
              border: "1.5px solid var(--line2)",
              borderRadius: 10,
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <SkeletonBar w={40} h={40} style={{ borderRadius: "50%" }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <SkeletonBar w="80%" h={13} />
                <SkeletonBar w="55%" h={11} />
              </div>
            </div>
            <SkeletonBar w="60%" h={11} />
          </div>
        ))}
      </div>
    </div>
  );
}
