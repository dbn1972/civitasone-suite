import { SkeletonBar, SkeletonCard } from "../../_components/ds";

/**
 * GAP-WORKFLOW-HOME-05 — hub loading skeleton. Uses DS token-based skeletons
 * (var(--line2)/var(--panel) via SkeletonBar/SkeletonCard) instead of Tailwind
 * `slate-*` utilities so the placeholders respect dark mode. Mirrors the hub:
 * 4 stat cards, 2 info cards, and 4 nav tiles (matching columns="four").
 */
export default function WorkflowLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading workflow…</span>
      <div style={{ display: "grid", gap: 8 }}>
        <SkeletonBar w={288} h={30} />
        <SkeletonBar w={448} h={16} />
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 24 }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginTop: 20 }}
      >
        <SkeletonBar h={224} style={{ borderRadius: 12 }} />
        <SkeletonBar h={224} style={{ borderRadius: 12 }} />
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginTop: 20 }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBar key={i} h={112} style={{ borderRadius: 12 }} />
        ))}
      </div>
    </div>
  );
}
