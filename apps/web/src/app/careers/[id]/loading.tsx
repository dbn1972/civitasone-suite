import { SkeletonBar } from "@/app/_components/ds";

/** Skeleton for a vacancy detail page while the vacancy loads. */
export default function VacancyLoading() {
  return (
    <main role="status" aria-busy="true" aria-label="Loading vacancy" style={{ minHeight: "100vh", background: "#f8fafc" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px 64px", display: "grid", gap: 14 }}>
        <SkeletonBar w={100} h={14} />
        <SkeletonBar w="70%" h={30} />
        <SkeletonBar h={64} style={{ borderRadius: 10 }} />
        <SkeletonBar h={140} style={{ borderRadius: 10 }} />
      </div>
    </main>
  );
}
