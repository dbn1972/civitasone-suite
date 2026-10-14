import { SkeletonBar } from "@/app/_components/ds/Skeleton";

function Bar({ w, h, mb, r }: { w: number | string; h: number; mb?: number; r?: number }) {
  return <SkeletonBar w={w} h={h} style={{ marginBottom: mb, borderRadius: r ?? 8 }} />;
}

export default function ContractsListLoading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading contracts list">
      <div className="ph">
        <div>
          <Bar w={220} h={28} mb={8} />
          <Bar w={320} h={14} />
        </div>
      </div>
      <div className="card" style={{ padding: 16, marginTop: 18 }}>
        <Bar w={180} h={16} mb={16} />
        {Array.from({ length: 6 }).map((_, i) => (
          <Bar key={i} w="100%" h={18} mb={12} />
        ))}
      </div>
    </div>
  );
}
