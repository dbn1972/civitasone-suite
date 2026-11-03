import { SkeletonBar } from "@/app/_components/ds";

/** Skeleton for a GIGW compliance page (UAT-P2-D3, A11Y-19). */
export default function AccessibilityStatementLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ maxWidth: 768, margin: "0 auto", padding: "40px 16px", display: "grid", gap: 16 }}>
      <SkeletonBar w="50%" h={32} />
      <SkeletonBar w="80%" h={16} />
      <SkeletonBar h={64} style={{ borderRadius: 8 }} />
      <SkeletonBar w="40%" h={20} />
      <SkeletonBar w="70%" h={16} />
    </div>
  );
}
