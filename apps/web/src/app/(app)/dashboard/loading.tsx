import { SkeletonBar } from "@/app/_components/ds/Skeleton";

export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading dashboard…</span>
      <div className="ph">
        <div>
          <SkeletonBar w={240} h={28} style={{ borderRadius: 8 }} />
          <SkeletonBar w={420} h={16} style={{ borderRadius: 6, marginTop: 10 }} />
        </div>
      </div>
      <div className="grid g-2" style={{ marginBottom: 24 }}>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card">
            <div className="card-h">
              <SkeletonBar w={200} h={18} style={{ borderRadius: 6 }} />
            </div>
            <div className="pad">
              <div className="grid g-2">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="stat">
                    <SkeletonBar w="70%" h={16} style={{ borderRadius: 6 }} />
                    <SkeletonBar w="90%" h={12} style={{ borderRadius: 6, marginTop: 8 }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid g-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="stat">
            <div className="top">
              <div />
              <SkeletonBar w={42} h={42} style={{ borderRadius: 11 }} />
            </div>
            <SkeletonBar w="85%" h={14} style={{ borderRadius: 6, marginTop: 16 }} />
            <SkeletonBar w="55%" h={18} style={{ borderRadius: 6, marginTop: 8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
