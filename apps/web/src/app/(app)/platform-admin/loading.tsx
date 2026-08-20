import { SkeletonCard } from "@/app/_components/ds";

export default function Loading() {
  return (
    <div className="page-main">
      <div className="ph" style={{ marginBottom: 20 }}>
        <div className="skeleton" style={{ height: 28, width: 200, borderRadius: 6 }} />
        <div className="skeleton" style={{ height: 18, width: 320, borderRadius: 6, marginTop: 6 }} />
      </div>
      <div className="grid g-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
