import { SkeletonBar } from "@/app/_components/ds";

/** Skeleton for the public careers home while the vacancy list loads (GAP-RECRUITMENT-CAREERS-HOME-06). */
export default function CareersLoading() {
  return (
    <main role="status" aria-busy="true" aria-label="Loading openings" style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "56px 24px 64px", display: "grid", gap: 16 }}>
        <SkeletonBar w="40%" h={36} style={{ margin: "0 auto" }} />
        <SkeletonBar w="65%" h={18} style={{ margin: "0 auto" }} />
        <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
          <SkeletonBar w={96} h={32} style={{ borderRadius: 20 }} />
          <SkeletonBar w={84} h={32} style={{ borderRadius: 20 }} />
          <SkeletonBar w={110} h={32} style={{ borderRadius: 20 }} />
        </div>
        <SkeletonBar h={110} style={{ borderRadius: 14 }} />
        <SkeletonBar h={110} style={{ borderRadius: 14 }} />
        <SkeletonBar h={110} style={{ borderRadius: 14 }} />
      </div>
    </main>
  );
}
