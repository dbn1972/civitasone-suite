import { SkeletonCard, SkeletonBar } from "@/app/_components/ds";

/**
 * GAP-DEVELOPER-PORTAL-HOME-05: match the loaded page's shell exactly so there
 * is no layout jump. The page renders `<div className="wrap">` with a
 * PageHeader and a `.grid.g-4` of 4 stat cards followed by a card. Mirror that
 * here with the shared ds skeletons, which are built on theme CSS variables
 * (--panel/--line/--line2) and so follow dark mode — no slate/hex colours.
 */
export default function DeveloperPortalLoading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading Developer Portal…">
      <div className="ph" style={{ marginBottom: 18 }}>
        <SkeletonBar w={220} h={28} />
        <SkeletonBar w={360} h={16} style={{ marginTop: 8 }} />
      </div>
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <SkeletonBar w="30%" h={16} />
        <div className="grid g-3" style={{ marginTop: 4 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
