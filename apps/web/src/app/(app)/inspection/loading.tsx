import { SkeletonBar, SkeletonCard } from "@/app/_components/ds";

/**
 * GAP-INSPECTION-HOME-04: a skeleton that mirrors the loaded hub (title +
 * subtitle, 3 stat cards, 3 nav tiles) so there is no layout jump, replacing
 * the previous bare "Loading inspection…" text line. Uses the DS Skeleton
 * primitives (same tokens the loaded view uses).
 */
export default function Loading() {
  return (
    <div className="page-main" aria-busy="true" aria-label="Loading inspection…">
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        <SkeletonBar w={180} h={28} />
        <SkeletonBar w={320} h={14} />
      </div>
      <div className="grid g-4">
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
          marginTop: 18,
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            aria-hidden="true"
            style={{ height: 96, borderRadius: 12, background: "var(--line2)" }}
          />
        ))}
      </div>
    </div>
  );
}
