import { SkeletonBar } from "@/app/_components/ds/Skeleton";

export default function Loading() {
  return (
    <div className="page-main wrap" style={{ animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }} role="status" aria-live="polite" aria-label="Loading…">
      <div style={{ marginBottom: 24 }}>
        <SkeletonBar w={160} h={16} style={{ borderRadius: 4, marginBottom: 8 }} />
        <SkeletonBar w={256} h={32} style={{ borderRadius: 4 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
        {[0, 1].map((i) => (<div key={i} style={{ height: 96, borderRadius: 12, background: "var(--line2)" }} />))}
      </div>
      <SkeletonBar h={160} style={{ borderRadius: 12, marginTop: 18 }} />
      <SkeletonBar h={160} style={{ borderRadius: 12, marginTop: 18 }} />
      <SkeletonBar h={120} style={{ borderRadius: 12, marginTop: 18 }} />
    </div>
  );
}
