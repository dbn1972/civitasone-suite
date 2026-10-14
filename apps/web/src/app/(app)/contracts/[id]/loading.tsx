import { SkeletonBar } from "@/app/_components/ds/Skeleton";

function Bar({ w, h, mb, r }: { w: number | string; h: number; mb?: number; r?: number }) {
  return <SkeletonBar w={w} h={h} style={{ marginBottom: mb, borderRadius: r ?? 8 }} />;
}

export default function ContractDetailLoading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading contract details">
      <div className="ph">
        <div>
          <Bar w={260} h={28} mb={8} />
          <Bar w={160} h={14} />
        </div>
      </div>
      <div className="card" style={{ padding: 16, marginTop: 18 }}>
        <Bar w={140} h={16} mb={20} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ display: "flex", gap: 16, marginBottom: 14 }}>
            <Bar w={120} h={16} />
            <Bar w={200} h={16} />
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 16, marginTop: 18 }}>
        <Bar w={100} h={16} mb={20} />
        <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
          <Bar w={120} h={16} />
          <Bar w={160} h={16} />
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <Bar w={120} h={16} />
          <Bar w={160} h={16} />
        </div>
      </div>
    </div>
  );
}
