import { TileHubSkeleton, SkeletonBar } from "../../_components/ds";

/**
 * Loading skeleton for the Help Centre hub. Mirrors the real layout
 * (GAP-HELP-HOME-05): a header, one section of guide tiles, then one card for
 * the glossary — no stat-card row, which this page never shows.
 */
export default function Loading() {
  return (
    <section className="page-main wrap" aria-label="Loading Help Centre">
      <TileHubSkeleton sections={1} tilesPerSection={6} />
      <div
        aria-hidden="true"
        style={{
          marginTop: 24,
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: 18,
          display: "grid",
          gap: 12,
        }}
      >
        <SkeletonBar w="40%" h={13} />
        <SkeletonBar w="30%" h={38} style={{ borderRadius: 10 }} />
        <SkeletonBar w="90%" h={13} />
        <SkeletonBar w="85%" h={13} />
        <SkeletonBar w="80%" h={13} />
      </div>
    </section>
  );
}
