import { SkeletonBar } from "@/app/_components/ds";

/** Skeleton for the candidate portal application list (GAP-RECRUITMENT-CAREERS-PORTAL-08). */
export default function PortalLoading() {
  return (
    <main role="status" aria-busy="true" aria-label="Loading your applications" style={{ minHeight: "100vh", background: "#f0f4f8" }}>
      <SkeletonBar h={48} style={{ borderRadius: 0 }} />
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px", display: "grid", gap: 12 }}>
        <SkeletonBar w="40%" h={26} />
        <SkeletonBar w="25%" h={14} />
        <SkeletonBar h={130} style={{ borderRadius: 12 }} />
        <SkeletonBar h={130} style={{ borderRadius: 12 }} />
        <SkeletonBar h={130} style={{ borderRadius: 12 }} />
      </div>
    </main>
  );
}
