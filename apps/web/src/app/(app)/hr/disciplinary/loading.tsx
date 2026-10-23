import { SkeletonBar } from "@/app/_components/ds/Skeleton";

export default function Loading() {
  return (
    <div className="page-main">
      <div className="ph">
        <div>
          <div data-skeleton-heading="">Disciplinary Cases</div>
          <div className="sub">Loading disciplinary cases…</div>
        </div>
      </div>
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <SkeletonBar h={120} style={{ borderRadius: 12 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ height: 80, borderRadius: 12, background: "var(--line2)" }} />
          ))}
        </div>
        <SkeletonBar h={240} style={{ borderRadius: 12 }} />
      </div>
    </div>
  );
}
