import { SkeletonCard, SkeletonBar } from "../../_components/ds";

/**
 * GAP-HELPDESK-HOME-04: uses DS Skeleton (theme-aware CSS variables) instead of
 * hard-coded bg-slate-50/bg-slate-200 that flashes white in dark theme. Shows
 * 8 skeleton stat cards to match the 8 StatCards on page.tsx, plus a Quick
 * Navigation card placeholder.
 */
export default function HelpdeskLoading() {
  return (
    <div aria-busy="true" aria-label="Loading helpdesk…" style={{ padding: "4px 0" }}>
      {/* Header skeleton */}
      <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        <SkeletonBar w={180} h={28} />
        <SkeletonBar w={320} h={14} />
      </div>

      {/* 8 stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      {/* Quick Navigation card placeholder */}
      <div
        aria-hidden="true"
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
        <SkeletonBar w={140} h={16} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonBar key={i} w="100%" h={60} />
          ))}
        </div>
      </div>
    </div>
  );
}
