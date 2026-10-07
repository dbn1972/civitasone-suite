import { SkeletonBar, SkeletonCard } from "../../../_components/ds";

/**
 * GAP-CHANGE-HOME-05: comms/release-notes loading state built from DS Skeleton
 * components (theme-token colours, visible in dark mode) instead of hard-coded
 * Tailwind grays, matching the page's header + stat + release-note cards.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading release notes">
      <div style={{ marginBottom: 20 }}>
        <SkeletonBar w={240} h={28} />
        <div style={{ marginTop: 8 }}>
          <SkeletonBar w={360} h={14} />
        </div>
      </div>
      <div style={{ maxWidth: 260, marginBottom: 20 }}>
        <SkeletonCard />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {[0, 1, 2].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
