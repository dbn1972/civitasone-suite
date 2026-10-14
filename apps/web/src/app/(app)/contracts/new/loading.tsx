import { SkeletonBar } from "@/app/_components/ds/Skeleton";

function Bar({ w, h, mb, r }: { w: number | string; h: number; mb?: number; r?: number }) {
  return <SkeletonBar w={w} h={h} style={{ marginBottom: mb, borderRadius: r ?? 8 }} />;
}

export default function NewContractLoading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading form">
      <div className="ph">
        <div>
          <Bar w={200} h={28} mb={8} />
          <Bar w={300} h={14} />
        </div>
      </div>
      <div className="card" style={{ padding: 24, marginTop: 18, maxWidth: 672 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            <Bar w={100} h={12} mb={8} />
            <Bar w="100%" h={36} />
          </div>
        ))}
        <Bar w={140} h={40} />
      </div>
    </div>
  );
}
