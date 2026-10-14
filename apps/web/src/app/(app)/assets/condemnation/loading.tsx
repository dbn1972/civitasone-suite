import { SkeletonBar } from "@/app/_components/ds/Skeleton";

export default function Loading() {
  return (
    <div className="animate-pulse" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SkeletonBar w={120} h={14} style={{ borderRadius: 6 }} />
      <SkeletonBar w={420} h={32} style={{ borderRadius: 8 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <SkeletonBar h={220} style={{ borderRadius: 12 }} />
        <SkeletonBar h={220} style={{ borderRadius: 12 }} />
        <SkeletonBar h={220} style={{ borderRadius: 12 }} />
      </div>
    </div>
  );
}
