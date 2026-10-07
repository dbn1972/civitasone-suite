import { SkeletonCard } from "@/app/_components/ds";

// GAP-METADATA-HOME-04: the hub has FIVE tiles in a `md:grid-cols-2` grid;
// the skeleton used to render six cards in a different `g-3` grid, so the
// loading state didn't match the page it stands in for. Match both the count
// (5) and the grid classes exactly.
export default function Loading() {
  return (
    <div className="page-main">
      <div className="ph" style={{ marginBottom: 20 }}>
        <div className="skeleton" style={{ height: 28, width: 200, borderRadius: 6 }} />
        <div className="skeleton" style={{ height: 18, width: 320, borderRadius: 6, marginTop: 6 }} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
