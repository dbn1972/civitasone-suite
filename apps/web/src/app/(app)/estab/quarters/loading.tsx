import { SkeletonBar, SkeletonCard, SkeletonTable } from "@/app/_components/ds";

/**
 * GAP-ESTAB-QUARTERS-05: page-shaped loading skeleton (header + four stat
 * tiles + table) instead of a single bare shimmer block.
 */
export default function QuartersLoading() {
  return (
    <div className="page-main wrap" aria-busy="true">
      <div style={{ marginBottom: 18 }}>
        <SkeletonBar w={240} h={26} />
        <div style={{ marginTop: 8 }}><SkeletonBar w={400} h={14} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 18 }}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <SkeletonTable rows={8} />
    </div>
  );
}
