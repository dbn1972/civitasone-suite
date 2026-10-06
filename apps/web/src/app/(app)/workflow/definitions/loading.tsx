import { SkeletonBar, SkeletonCard } from "../../../_components/ds";

/**
 * GAP-WORKFLOW-DEFINITIONS-06 — loading skeleton aligned to the page: 3 stat
 * cards (Total/Active/Templates), a workflows table card and a templates card.
 * Uses DS token-based skeletons (dark-mode safe) instead of Tailwind slate-*.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div style={{ display: "grid", gap: 8 }}>
        <SkeletonBar w={288} h={30} />
        <SkeletonBar w={384} h={16} />
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 24 }}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div style={{ marginTop: 20 }}>
        <SkeletonBar h={320} style={{ borderRadius: 12 }} />
      </div>
      <div style={{ marginTop: 16 }}>
        <SkeletonBar h={200} style={{ borderRadius: 12 }} />
      </div>
    </div>
  );
}
