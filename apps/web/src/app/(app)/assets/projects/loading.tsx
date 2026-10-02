import { SkeletonBar, SkeletonCard, SkeletonTable } from "@/app/_components/ds/Skeleton";

/**
 * GAP-ASSETS-PROJECTS-08: mirrors the page shape (header, 4 stat tiles, create
 * form card, register table) so nothing jumps when the data arrives.
 */
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading AUC projects…" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <SkeletonBar w={140} h={12} />
        <SkeletonBar w={260} h={30} />
        <SkeletonBar w="60%" h={12} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
      </div>
      <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 18, display: "grid", gap: 14 }}>
        <SkeletonBar w={160} h={16} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          {[0, 1, 2, 3].map((i) => <SkeletonBar key={i} h={44} style={{ borderRadius: 10 }} />)}
        </div>
        <SkeletonBar w={170} h={44} style={{ borderRadius: 10 }} />
      </div>
      <SkeletonTable rows={6} />
    </div>
  );
}
