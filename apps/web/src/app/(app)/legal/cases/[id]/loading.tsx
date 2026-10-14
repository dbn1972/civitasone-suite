import { SkeletonBar } from "@/app/_components/ds/Skeleton";

export default function LegalCaseDetailLoading() {
  return (
    <div className="wrap">
      <div className="animate-pulse" aria-busy="true" aria-label="Loading case details">
        {/* Breadcrumb skeleton */}
        <SkeletonBar w={220} h={16} style={{ borderRadius: 4, marginBottom: 12 }} />
        {/* Page header skeleton */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 24 }}>
          <SkeletonBar w={320} h={32} style={{ borderRadius: 6 }} />
          <SkeletonBar w={120} h={32} style={{ borderRadius: 6, marginLeft: "auto" }} />
        </div>
        {/* Two-column grid */}
        <div className="grid g-main" style={{ alignItems: "start", gap: 18 }}>
          {/* Left column */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <SkeletonBar h={280} style={{ borderRadius: 10 }} />
            <SkeletonBar h={160} style={{ borderRadius: 10 }} />
            <SkeletonBar h={120} style={{ borderRadius: 10 }} />
          </div>
          {/* Right column */}
          <SkeletonBar h={200} style={{ borderRadius: 10 }} />
        </div>
      </div>
    </div>
  );
}
