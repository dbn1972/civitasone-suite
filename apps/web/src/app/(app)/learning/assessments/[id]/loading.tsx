import { SkeletonBar } from "@/app/_components/ds";

export default function Loading() {
  return (
    <div className="space-y-4 p-6" aria-label="Loading" aria-busy="true">
      <SkeletonBar w={240} h={28} />
      <SkeletonBar w={320} h={14} />
      <div className="card">
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <SkeletonBar w="60%" h={14} />
              <SkeletonBar w="40%" h={12} />
              <SkeletonBar w="40%" h={12} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
