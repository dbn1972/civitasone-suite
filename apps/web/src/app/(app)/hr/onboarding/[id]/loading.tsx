import { SkeletonBar } from "../../../../_components/ds/Skeleton";

// GAP-HR-ONBOARDING-DETAIL-07: mirrors the loaded page's shape (header,
// welcome banner, two-column checklist/calendar, document section) using the
// shared ds/Skeleton primitive, instead of one bare `.skeleton` div with a
// hard-coded English aria-label unrelated to the page it's replacing.
export default function Loading() {
  return (
    <div className="page-main wrap" aria-label="Loading onboarding details" aria-busy="true">
      <div style={{ marginBottom: 20 }}>
        <SkeletonBar w={260} h={22} style={{ marginBottom: 8 }} />
        <SkeletonBar w={200} h={13} />
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "center", border: "1px solid var(--line, #e2e8f0)", borderRadius: 12, padding: "24px 28px", marginBottom: 20 }}>
        <SkeletonBar w={60} h={60} style={{ borderRadius: "50%" }} />
        <div style={{ flex: 1 }}>
          <SkeletonBar w={220} h={18} style={{ marginBottom: 12 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonBar key={i} w="80%" h={13} />
            ))}
          </div>
        </div>
        <SkeletonBar w={64} h={64} style={{ borderRadius: "50%" }} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 12, padding: 20 }}>
            <SkeletonBar w={160} h={15} style={{ marginBottom: 14 }} />
            {Array.from({ length: 3 }).map((__, j) => (
              <SkeletonBar key={j} w="100%" h={30} style={{ marginBottom: 10 }} />
            ))}
          </div>
        ))}
      </div>

      <div style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 12, padding: 20 }}>
        <SkeletonBar w={180} h={15} style={{ marginBottom: 14 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBar key={i} w="100%" h={90} style={{ borderRadius: 10 }} />
          ))}
        </div>
      </div>
    </div>
  );
}
