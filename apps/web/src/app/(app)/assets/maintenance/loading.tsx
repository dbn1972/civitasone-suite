import { SkeletonBar } from "@/app/_components/ds/Skeleton";

export default function Loading() {
  return (
    <div className="animate-pulse" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SkeletonBar w={160} h={14} style={{ borderRadius: 6 }} />
      <SkeletonBar w={280} h={32} style={{ borderRadius: 8 }} />
      <div className="grid g-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ height: 96, borderRadius: 12, background: "var(--line2)" }} />
        ))}
      </div>
      <SkeletonBar h={320} style={{ borderRadius: 12 }} />
    </div>
  );
}
