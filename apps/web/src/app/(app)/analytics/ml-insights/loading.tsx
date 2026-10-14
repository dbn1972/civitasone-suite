import { SkeletonBar } from "@/app/_components/ds/Skeleton";

export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading ML Insights">
      <SkeletonBar w="40%" h={32} style={{ marginBottom: 8 }} />
      <SkeletonBar w="60%" h={16} style={{ marginBottom: 24 }} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBar key={i} h={80} style={{ borderRadius: 8 }} />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBar key={i} h={160} style={{ borderRadius: 8 }} />
        ))}
      </div>
    </div>
  );
}
