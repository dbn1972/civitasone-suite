import { SkeletonBar, SkeletonCard } from "@/app/_components/ds";

/**
 * GAP-POLICY-HOME-03: a form-shaped skeleton (a couple of input bars + a submit
 * block) instead of the bare "Loading evaluate…" paragraph.
 */
export default function Loading() {
  return (
    <div className="page-main wrap" aria-busy="true" aria-label="Loading evaluate">
      <div style={{ display: "grid", gap: 12, maxWidth: 640 }}>
        <SkeletonBar w="40%" h={14} />
        <SkeletonBar w="100%" h={38} />
        <SkeletonBar w="40%" h={14} />
        <SkeletonBar w="100%" h={96} />
        <SkeletonBar w={120} h={38} />
        <SkeletonCard />
      </div>
    </div>
  );
}
