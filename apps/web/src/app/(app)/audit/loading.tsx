import { SkeletonBar } from "@/app/_components/ds/Skeleton";

function Bar({ w, h, mb, r }: { w: number | string; h: number; mb?: number; r?: number }) {
  return <SkeletonBar w={w} h={h} style={{ marginBottom: mb, borderRadius: r ?? 8 }} />;
}

export default function AuditLoading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading audit page">
      <Bar w={180} h={14} mb={12} />
      <div className="ph">
        <div>
          <Bar w={280} h={28} mb={8} />
          <Bar w={360} h={14} />
        </div>
        <Bar w={130} h={38} r={10} />
      </div>
      <div className="grid g-4" style={{ margin: "18px 0" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card" style={{ padding: 16 }}>
            <Bar w={120} h={13} mb={12} />
            <Bar w={70} h={26} />
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 16 }}>
        <Bar w={200} h={16} mb={16} />
        {Array.from({ length: 6 }).map((_, i) => (
          <Bar key={i} w="100%" h={18} mb={12} />
        ))}
      </div>
    </div>
  );
}
