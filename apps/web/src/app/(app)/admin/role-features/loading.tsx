import { SkeletonCard, SkeletonTable } from "@/app/_components/ds";

// GAP-ADMIN-ROLE-FEATURES-06: same ds skeleton primitives as the sibling admin routes
// (was Tailwind animate-pulse utilities).
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading">
      <div className="grid g-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <SkeletonTable />
    </div>
  );
}
