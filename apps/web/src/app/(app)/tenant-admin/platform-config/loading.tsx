import { SkeletonCard } from "@/app/_components/ds";

// GAP-TENANT-ADMIN-PLATFORM-CONFIG-02: a route-local loading skeleton matching
// the two card grids (Tunable Settings + Infrastructure).
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading platform configuration…">
      <div className="skeleton" style={{ height: 60, marginBottom: 18 }} />
      <div className="grid g-2">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="grid g-2" style={{ marginTop: 28 }}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
