import { SkeletonBar } from "@/app/_components/ds/Skeleton";
import { StatGrid } from "../../_components/ds";

export default function ApprovalsLoading() {
  return (
    <div className="skeleton-page">
      <SkeletonBar w={200} h={32} style={{ marginBottom: 8 }} />
      <SkeletonBar w={340} h={16} style={{ marginBottom: 24 }} />
      {/* GAP-APPROVALS-HOME-08: reuse the StatGrid design-system wrapper (the
          same responsive `.grid.g-4` the real page uses) instead of a fixed
          inline repeat(4,1fr) that never collapsed on mobile, so the skeleton
          and the loaded page share one column layout at every width. */}
      <div style={{ marginBottom: 24 }}>
        <StatGrid>
          {[1, 2, 3, 4].map((i) => (
            <SkeletonBar key={i} h={80} style={{ borderRadius: 8 }} />
          ))}
        </StatGrid>
      </div>
      <SkeletonBar h={400} style={{ borderRadius: 8 }} />
    </div>
  );
}
