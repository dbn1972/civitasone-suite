import { SkeletonBar, SkeletonCard } from "../../../_components/ds/Skeleton";

// GAP-HR-ONBOARDING-07: this used to be a single bare `.skeleton` div with no
// relation to the loaded page's shape, so the loading state didn't match the
// height/layout of the header, stat tiles or card grid it briefly replaces
// (a visible layout jump once real content arrives). Mirrors the loaded
// page's structure using the same ds/Skeleton primitives other HR pages use.
export default function Loading() {
  return (
    <div className="page-main wrap" aria-label="Loading onboarding tracker" aria-busy="true">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <SkeletonBar w={220} h={22} style={{ marginBottom: 8 }} />
          <SkeletonBar w={340} h={13} />
        </div>
        <SkeletonBar w={140} h={36} style={{ borderRadius: 8 }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBar key={i} w={90} h={26} style={{ borderRadius: 20 }} />
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <SkeletonBar w={38} h={38} style={{ borderRadius: "50%" }} />
              <div style={{ flex: 1 }}>
                <SkeletonBar w="70%" h={13} style={{ marginBottom: 6 }} />
                <SkeletonBar w="40%" h={11} />
              </div>
            </div>
            <SkeletonBar w="100%" h={6} style={{ borderRadius: 99 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
